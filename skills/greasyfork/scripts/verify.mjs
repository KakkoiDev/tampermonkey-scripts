// Read-only sync check. No auth, no browser. For each script in greasyfork.json,
// compares the local @version against the published version (public API) and the
// version served at the GitHub raw URL. Exits non-zero on any drift.
import { loadManifest, repoInfo, rawUrl, fetchPublished, readLocalVersion, fetchRawVersion } from './lib.mjs';

const { scripts, locale = 'en' } = loadManifest();
const info = repoInfo();
console.log(`repo ${info.owner}/${info.repo}@${info.branch}\n`);

let drift = 0;
for (const s of scripts) {
  const local = readLocalVersion(s.file);
  let raw, published = null, note = '';
  try { raw = await fetchRawVersion(rawUrl(s.file, info)); } catch (e) { raw = `ERR(${e.message})`; }
  if (s.id) {
    try { published = (await fetchPublished(s.id, locale)).version; } catch (e) { published = `ERR(${e.message})`; }
  } else {
    note = '(unpublished)';
  }
  const synced = s.id && local === published && published === raw;
  if (s.id && !synced) drift++;
  const mark = !s.id ? '--   ' : synced ? 'OK   ' : 'DRIFT';
  console.log(`${mark} ${s.file} ${note}`);
  console.log(`        local=${local}  published=${published ?? 'n/a'}  raw=${raw}`);
}
console.log(drift ? `\n${drift} published script(s) out of sync.` : `\nAll published scripts in sync.`);
process.exit(drift ? 1 : 0);
