import { readFileSync, writeFileSync } from 'node:fs';

const re = /^(\s*\/\/\s*@version\s+)(\S+)(.*)$/m;

function today() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}.${mm}.${dd}`;
}

function nextVersion(current, day) {
  if (current === day) return `${day}.1`;
  if (current.startsWith(`${day}.`)) {
    const n = parseInt(current.slice(day.length + 1), 10);
    return Number.isNaN(n) ? `${day}.1` : `${day}.${n + 1}`;
  }
  return day;
}

const files = process.argv.slice(2);
const day = today();
let failed = false;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const m = src.match(re);
  if (!m) {
    console.error(`bump-version: no @version line in ${file}`);
    failed = true;
    continue;
  }
  const current = m[2];
  const next = nextVersion(current, day);
  if (next === current) continue;
  writeFileSync(file, src.replace(re, `$1${next}$3`));
  console.log(`bump-version: ${file} ${current} -> ${next}`);
}

process.exit(failed ? 1 : 0);
