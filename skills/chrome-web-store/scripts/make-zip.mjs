#!/usr/bin/env node
// Package a companion extension into a Chrome Web Store upload zip - runtime files only, derived from
// the manifest (manifest.json plus the JS/CSS/icons/rules it references). Excludes source.json, README,
// icon.svg, screenshots, .gitignore, _metadata, and anything the manifest does not reference.
// Usage: node make-zip.mjs <extensionDir> [--out=<path>]
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { basename, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };

if (!dir || !existsSync(join(dir, 'manifest.json'))) {
    console.error('usage: node make-zip.mjs <extensionDir> [--out=<path>]');
    console.error('(<extensionDir> must contain manifest.json)');
    process.exit(1);
}
const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

// collect every file the manifest references (skip glob patterns)
const files = new Set(['manifest.json']);
const add = (v) => { if (typeof v === 'string' && !v.includes('*')) files.add(v); };
for (const cs of man.content_scripts || []) { (cs.js || []).forEach(add); (cs.css || []).forEach(add); }
Object.values(man.icons || {}).forEach(add);
if (man.action) {
    const di = man.action.default_icon;
    if (typeof di === 'string') add(di); else Object.values(di || {}).forEach(add);
    if (man.action.default_popup) add(man.action.default_popup);
}
if (man.background && man.background.service_worker) add(man.background.service_worker);
for (const war of man.web_accessible_resources || []) (war.resources || []).forEach(add);
for (const rr of (man.declarative_net_request && man.declarative_net_request.rule_resources) || []) add(rr.path);

const missing = [...files].filter((f) => !existsSync(join(dir, f)));
if (missing.length) { console.error('missing files the manifest references:', missing.join(', ')); process.exit(1); }

const out = resolve(opt('out', resolve(dir, '..', `${basename(dir)}-cws.zip`)));
rmSync(out, { force: true });
execFileSync('zip', ['-r', out, ...files], { cwd: dir, stdio: 'ignore' });
console.log(`packaged ${files.size} files -> ${out}`);
execFileSync('unzip', ['-l', out], { stdio: 'inherit' });
