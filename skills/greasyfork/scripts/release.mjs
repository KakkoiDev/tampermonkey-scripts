// One-command release: sync every published script whose Greasy Fork version is
// behind the local file, then re-verify. Use this after pushing (or pass --push
// to push first). Exists because Greasy Fork's per-user webhook endpoint returns
// 403 to every POST (server-side; see docs/PUBLISHING.md), so auto-pull on push
// never fires - this forces the pull the webhook was supposed to trigger.
//
//   node skills/greasyfork/scripts/release.mjs          # after you've pushed
//   node skills/greasyfork/scripts/release.mjs --push   # push, then sync
//
// Requires login (persisted profile), like set-sync. Read-only steps need none.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  loadManifest, repoInfo, rawUrl, fetchPublished, fetchRawVersion, readLocalVersion,
  launchBrowser, ensureLoggedIn, syncScriptOnPage,
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { scripts, locale = 'en' } = loadManifest();
const info = repoInfo();

if (process.argv.includes('--push')) {
  console.log('git push...');
  execSync('git push', { stdio: 'inherit' });
}

// A published script needs a sync when Greasy Fork's version != the local file.
async function findDrift() {
  const out = [];
  for (const s of scripts) {
    if (!s.id) continue;
    const local = readLocalVersion(s.file);
    let raw = null, published = null;
    try { raw = await fetchRawVersion(rawUrl(s.file, info)); } catch { /* CDN not ready */ }
    try { published = (await fetchPublished(s.id, locale)).version; } catch { /* ignore */ }
    if (published !== local) out.push({ s, local, raw });
  }
  return out;
}

let pending = await findDrift();
if (!pending.length) {
  console.log('All published scripts already in sync. Nothing to do.');
  process.exit(0);
}
console.log(`Out of sync: ${pending.map((p) => p.s.file).join(', ')}`);

// Greasy Fork pulls the raw GitHub URL, so the raw CDN must already serve the
// local version - otherwise the sync re-pulls a stale file. Wait for it.
for (let i = 0; i < 10; i++) {
  const stale = pending.filter((p) => p.raw !== p.local);
  if (!stale.length) break;
  console.log(`waiting ~30s for raw CDN to catch up: ${stale.map((p) => p.s.file).join(', ')}`);
  await sleep(30000);
  pending = await findDrift();
}

const { browser, page } = await launchBrowser();
try {
  await ensureLoggedIn(page);
  for (const { s } of pending) {
    const r = await syncScriptOnPage(page, s, info);
    console.log(`\n[${s.id}] ${s.file} -> ${r.url}`);
    console.log(`  ${r.ok ? 'result: ' + r.message : '!! ' + r.message}`);
  }
} finally {
  await browser.close();
}

console.log('\nverifying...');
try {
  execSync(`node ${join(here, 'verify.mjs')}`, { stdio: 'inherit' });
} catch {
  console.error('\nStill drifting after sync - re-run, or check set-sync output above.');
  process.exit(1);
}
