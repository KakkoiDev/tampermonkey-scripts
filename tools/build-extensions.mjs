#!/usr/bin/env node
// Generate companion Chrome-extension bundles from their source userscript, so the userscript
// stays the single source of truth. Each extensions/<name>/source.json names its source
// .user.js; this copies that file into the extension (with a generated banner) and syncs the
// extension manifest's `version` to the userscript's @version. Hand-authored extensions (no
// source.json, e.g. csp-unlock) are left untouched.
//
// Prints each written path (one per line) so the pre-commit hook can `git add` them.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const EXT_DIR = join(ROOT, 'extensions');
const written = [];

// Chrome manifest versions are 1-4 dot-separated integers with no leading zeros.
const normalizeVersion = (v) => v.split('.').map((p) => String(parseInt(p, 10) || 0)).join('.');
const userscriptVersion = (src) => {
    const m = src.match(/^\/\/\s*@version\s+(.+)$/m);
    return m ? m[1].trim() : null;
};

if (!existsSync(EXT_DIR)) process.exit(0);

for (const name of readdirSync(EXT_DIR)) {
    const dir = join(EXT_DIR, name);
    const cfgPath = join(dir, 'source.json');
    if (!existsSync(cfgPath)) continue; // hand-authored extension, skip

    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    const srcPath = join(ROOT, cfg.userscript);
    if (!existsSync(srcPath)) {
        console.error(`build-extensions: source not found: ${cfg.userscript} (for ${name})`);
        process.exit(1);
    }
    const src = readFileSync(srcPath, 'utf8');

    // 1) the content-script body = a copy of the userscript, with a generated banner
    const out = cfg.out || `${name}.js`;
    const outPath = join(dir, out);
    const body = `// GENERATED from ${cfg.userscript} by tools/build-extensions.mjs - do not edit.\n`
        + `// Edit the source userscript instead; this file is regenerated on commit.\n`
        + src;
    if (!existsSync(outPath) || readFileSync(outPath, 'utf8') !== body) {
        writeFileSync(outPath, body);
        written.push(join('extensions', name, out));
    }

    // 2) keep the manifest version in step with the userscript @version
    const manPath = join(dir, 'manifest.json');
    const uv = userscriptVersion(src);
    if (existsSync(manPath) && uv) {
        const man = JSON.parse(readFileSync(manPath, 'utf8'));
        const nv = normalizeVersion(uv);
        if (man.version !== nv) {
            man.version = nv;
            writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');
            written.push(join('extensions', name, 'manifest.json'));
        }
    }
}

if (written.length) console.log(written.join('\n'));
