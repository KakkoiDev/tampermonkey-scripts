// Publish a NEW userscript to Greasy Fork (the most consequential write: it
// creates a public/unlisted listing). Pastes the local file's code, sets
// visibility from the manifest, submits, captures the new id, and writes it
// back to greasyfork.json. Requires login (persisted profile).
//
// usage: node register.mjs <file.user.js>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest, launchBrowser, ensureLoggedIn, GF } from './lib.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node register.mjs <file.user.js>');
  process.exit(1);
}
const manifest = loadManifest();
const entry = manifest.scripts.find((s) => s.file === file);
if (!entry) {
  console.error(`No manifest entry for "${file}" in greasyfork.json.`);
  process.exit(1);
}
if (entry.id) {
  console.error(`"${file}" already has id ${entry.id}. Refusing to create a duplicate.`);
  process.exit(1);
}
const code = readFileSync(join(process.cwd(), file), 'utf8');
const typeValue = entry.visibility === 'unlisted' ? '2' : entry.visibility === 'library' ? '3' : '1';
console.log(`Registering ${file} as ${entry.visibility} (script_type=${typeValue})`);

const { browser, page } = await launchBrowser();
try {
  await ensureLoggedIn(page);
  await page.goto(`${GF}/en/script_versions/new`, { waitUntil: 'networkidle2', timeout: 60000 });

  // Code field is a plain textarea unless the syntax editor is opted into (it isn't).
  await page.$eval('#script_version_code', (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, code);
  await page.$eval(`#script_script_type_${typeValue}`, (el) => {
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const btn = await page.$('input[name="commit"]');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
    btn.click(),
  ]);

  const url = page.url();
  const m = url.match(/\/scripts\/(\d+)/);
  if (!m) {
    const err = await page.evaluate(() => {
      const e = document.querySelector('#error_explanation, .alert, .errorlist, .form-error');
      return (e?.innerText || document.body.innerText).slice(0, 1000);
    });
    console.error(`Did NOT land on a script page. URL=${url}\n--- page said ---\n${err}`);
    process.exit(2);
  }

  const id = m[1];
  console.log(`OK: ${file} -> script id ${id}\n     ${url}`);

  entry.id = id; // entry is a reference into manifest.scripts
  const { path, ...data } = manifest; // path is injected by loadManifest; don't write it
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`Wrote id ${id} into ${path}`);
} finally {
  await browser.close();
}
