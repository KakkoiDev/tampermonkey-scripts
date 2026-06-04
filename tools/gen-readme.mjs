// Regenerate the README "Scripts" table from greasyfork.json (single source of
// truth) so it can't drift. Replaces whatever is between the scripts:start /
// scripts:end markers in README.md. Run by the pre-commit hook; safe to run by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const manifest = JSON.parse(readFileSync(join(cwd, 'greasyfork.json'), 'utf8'));
const readmePath = join(cwd, 'README.md');
const START = '<!-- scripts:start -->';
const END = '<!-- scripts:end -->';

function runsOn(file) {
    const src = readFileSync(join(cwd, file), 'utf8');
    const hosts = [...src.matchAll(/^\s*\/\/\s*@match\s+(\S+)/gm)]
        .map((m) => m[1].replace(/^[a-z*]+:\/\//i, '').replace(/\/\*$/, ''));
    return [...new Set(hosts)].map((h) => `\`${h}\``).join(', ');
}

function install(s) {
    if (!s.id) return 'not yet published';
    const url = `https://greasyfork.org/en/scripts/${s.id}`;
    return `[Greasy Fork](${url})${s.visibility === 'unlisted' ? ' (unlisted - direct link)' : ''}`;
}

const rows = manifest.scripts.map(
    (s) => `| [${s.name}](${s.file}) | ${s.blurb || ''} | ${runsOn(s.file)} | ${install(s)} |`,
);
const table = ['| Script | What it does | Runs on | Install |', '|---|---|---|---|', ...rows].join('\n');

const readme = readFileSync(readmePath, 'utf8');
const i = readme.indexOf(START);
const j = readme.indexOf(END);
if (i < 0 || j < 0 || j < i) {
    console.warn(`gen-readme: ${START} / ${END} markers not found in README.md - skipping`);
    process.exit(0);
}
const next = readme.slice(0, i + START.length) + '\n' + table + '\n' + readme.slice(j);
if (next === readme) {
    console.log('gen-readme: README already up to date');
} else {
    writeFileSync(readmePath, next);
    console.log('gen-readme: README scripts table updated');
}
