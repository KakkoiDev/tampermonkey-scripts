// Configure "sync from URL" + Automatic on published scripts, then trigger an
// immediate sync. Args: script ids/filenames, or "all" / none = every published
// script in greasyfork.json. Requires login (persisted profile).
import { loadManifest, repoInfo, launchBrowser, ensureLoggedIn, syncScriptOnPage } from './lib.mjs';

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
    const r = await syncScriptOnPage(page, s, info);
    console.log(`\n[${s.id}] ${s.file} -> ${r.url}`);
    console.log(`  ${r.ok ? 'result' : '!! ' + r.message}${r.ok ? ': ' + r.message : ''}`);
  }
} finally {
  await browser.close();
}
