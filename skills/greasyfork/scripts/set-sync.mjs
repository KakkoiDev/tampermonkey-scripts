// Configure "sync from URL" + Automatic on published scripts, then trigger an
// immediate sync. Args: script ids/filenames, or "all" / none = every published
// script in greasyfork.json. Requires login (persisted profile).
import { loadManifest, repoInfo, rawUrl, launchBrowser, ensureLoggedIn, GF } from './lib.mjs';

const sel = process.argv.slice(2);
const { scripts } = loadManifest();
const info = repoInfo();
const want = (s) =>
  s.id && (sel.length === 0 || sel.includes('all') || sel.includes(String(s.id)) || sel.includes(s.file));
const targets = scripts.filter(want);
if (!targets.length) {
  console.error('No matching published scripts in greasyfork.json.');
  process.exit(1);
}

const { browser, page } = await launchBrowser();
try {
  await ensureLoggedIn(page);
  for (const s of targets) {
    const url = rawUrl(s.file, info);
    console.log(`\n[${s.id}] ${s.file} -> ${url}`);
    await page.goto(`${GF}/en/scripts/${s.id}/admin`, { waitUntil: 'networkidle2', timeout: 60000 });
    if (!(await page.$('#script_sync_identifier'))) {
      console.error('  !! #script_sync_identifier not found (not your script / layout changed). Skipping.');
      continue;
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
    const flash = await page.evaluate(() => {
      const g = (s) => document.querySelector(s)?.innerText?.trim();
      return g('.flash') || g('.notice') || g('.alert') || g('[role=alert]') || '(no flash message)';
    });
    console.log(`  result: ${flash}`);
  }
} finally {
  await browser.close();
}
