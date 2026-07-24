#!/usr/bin/env node
// Rasterize an SVG into PNG icons at Chrome-extension sizes, using the Puppeteer that ships
// with the greasyfork skill (no extra install). Usage:
//   node tools/make-icons.mjs <svg> <outdir> [sizes...]   (default sizes: 16 32 48 128)
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(resolve('skills/greasyfork/scripts/') + '/');
const puppeteer = require('puppeteer');

const [, , svgPath, outDir, ...rest] = process.argv;
if (!svgPath || !outDir) {
    console.error('usage: node tools/make-icons.mjs <svg> <outdir> [sizes...]');
    process.exit(1);
}
const sizes = rest.length ? rest.map(Number) : [16, 32, 48, 128];
const svg = readFileSync(svgPath, 'utf8');
const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
    const page = await browser.newPage();
    for (const s of sizes) {
        await page.setViewport({ width: s, height: s, deviceScaleFactor: 1 });
        await page.setContent(
            `<html><body style="margin:0;padding:0">`
            + `<img src="${dataUrl}" width="${s}" height="${s}" style="display:block">`
            + `</body></html>`);
        const img = await page.$('img');
        const out = join(outDir, `icon-${s}.png`);
        await img.screenshot({ path: out, omitBackground: true });
        console.log('wrote', out);
    }
} finally {
    await browser.close();
}
