// Shared helpers for the greasyfork skill. Read-only helpers use Node's built-in
// fetch (no deps). Browser helpers lazy-import puppeteer so verify.mjs stays
// usable even when puppeteer isn't installed.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const PROFILE_DIR = join(homedir(), '.cache', 'greasyfork', 'profile');
export const GF = 'https://greasyfork.org';

const VER = /^\s*\/\/\s*@version\s+(\S+)/m;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function loadManifest(cwd = process.cwd()) {
  const path = join(cwd, 'greasyfork.json');
  return { path, ...JSON.parse(readFileSync(path, 'utf8')) };
}

// owner/repo/branch derived from git so nothing is hardcoded per-user.
export function repoInfo(cwd = process.cwd()) {
  const git = (cmd) => execSync(`git ${cmd}`, { cwd, encoding: 'utf8' }).trim();
  const remote = git('remote get-url origin');
  const m = remote.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Cannot parse owner/repo from remote: ${remote}`);
  return { owner: m[1], repo: m[2], branch: git('rev-parse --abbrev-ref HEAD') };
}

export function rawUrl(file, info = repoInfo()) {
  return `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.branch}/${file}`;
}

export function readLocalVersion(file, cwd = process.cwd()) {
  return readFileSync(join(cwd, file), 'utf8').match(VER)?.[1] ?? null;
}

export async function fetchPublished(id, locale = 'en') {
  const r = await fetch(`https://api.greasyfork.org/${locale}/scripts/${id}.json`);
  if (!r.ok) throw new Error(`API ${id}: HTTP ${r.status}`);
  const j = await r.json();
  return { version: j.version, name: j.name, codeUrl: j.code_url };
}

export async function fetchRawVersion(url) {
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error(`raw HTTP ${r.status}`);
  return (await r.text()).match(VER)?.[1] ?? null;
}

// Set a published script to sync-from-URL (Automatic) and trigger an immediate
// pull, by driving its Greasy Fork Admin page. Used by release.mjs. Returns the
// flash text. The form selectors live here so there's one place to fix them.
export async function syncScriptOnPage(page, s, info = repoInfo()) {
  const url = rawUrl(s.file, info);
  await page.goto(`${GF}/en/scripts/${s.id}/admin`, { waitUntil: 'networkidle2', timeout: 60000 });
  if (!(await page.$('#script_sync_identifier'))) {
    return { url, ok: false, message: '#script_sync_identifier not found (not your script / layout changed)' };
  }
  await page.$eval('#script_sync_identifier', (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, url);
  await page.$eval('#script_sync_type_automatic', (el) => {
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const btn = await page.$('input[name="update-and-sync"]');
  await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
    btn.click(),
  ]);
  const message = await page.evaluate(() => {
    const g = (sel) => document.querySelector(sel)?.innerText?.trim();
    return g('.flash') || g('.notice') || g('.alert') || g('[role=alert]') || '(no flash message)';
  });
  return { url, ok: true, message };
}

export async function launchBrowser() {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: PROFILE_DIR,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.setUserAgent(UA);
  return { browser, page };
}

// Greasy Fork has no API auth. We reuse a persisted browser profile: the user
// logs in once in the visible window, every later run reuses the session.
// Detection polls in a SEPARATE background tab so the user's login tab is never
// reloaded mid-input. The check must run in-browser (user's IP) because of
// Cloudflare; a Node-side fetch from elsewhere would be blocked.
export async function ensureLoggedIn(page) {
  const poll = await page.browser().newPage();
  await poll.setUserAgent(UA);
  await page.bringToFront();
  const loggedIn = async () => {
    try {
      await poll.goto(`${GF}/en/users/webhook-info`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return await poll.evaluate(() => document.body.innerText.includes('Setting up a webhook'));
    } catch {
      return false;
    }
  };
  try {
    if (await loggedIn()) return true;
    await page.goto(`${GF}/en/users/sign_in`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await page.bringToFront();
    console.error('\n>>> Log in to Greasy Fork in the front browser tab. Detecting automatically; your tab is not reloaded.\n');
    for (let i = 0; i < 75; i++) {
      await page.bringToFront();
      await sleep(7000);
      if (await loggedIn()) {
        console.error('>>> Login detected. Continuing.\n');
        return true;
      }
    }
    throw new Error('Still not logged in after ~9 min.');
  } finally {
    await poll.close().catch(() => {});
  }
}
