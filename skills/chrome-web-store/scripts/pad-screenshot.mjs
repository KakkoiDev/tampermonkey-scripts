#!/usr/bin/env node
// Pad/resize a screenshot to a valid Chrome Web Store size (1280x800 or 640x400), letterboxing on a
// background color. Prints a WARNING when padding was needed (the shot was not the target aspect ratio).
// macOS only - uses the built-in `sips`.
// Usage: node pad-screenshot.mjs <image> [--size=1280x800] [--bg=252525] [--out=<path>]
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const size = opt('size', '1280x800');
const bg = opt('bg', '252525').replace(/^#/, '');

if (!src || !existsSync(src)) {
    console.error('usage: node pad-screenshot.mjs <image> [--size=1280x800|640x400] [--bg=252525] [--out=<path>]');
    process.exit(1);
}
const [tw, th] = size.split('x').map(Number);
if (![[1280, 800], [640, 400]].some(([w, h]) => w === tw && h === th)) {
    console.log(`WARNING: ${size} is not a Chrome Web Store screenshot size (1280x800 or 640x400) - continuing anyway.`);
}
const out = opt('out', src.replace(/(\.[a-z]+)?$/i, `-${tw}x${th}.png`));

const dims = (f) => {
    const o = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', f], { encoding: 'utf8' });
    return { w: +o.match(/pixelWidth:\s*(\d+)/)[1], h: +o.match(/pixelHeight:\s*(\d+)/)[1] };
};

const { w: sw, h: sh } = dims(src);
const scale = Math.min(tw / sw, th / sh);
const nw = Math.max(1, Math.round(sw * scale));
const nh = Math.max(1, Math.round(sh * scale));

const tmp = `${out}.tmp.png`;
execFileSync('sips', ['--resampleHeightWidth', String(nh), String(nw), src, '--out', tmp]);
execFileSync('sips', ['--padToHeightWidth', String(th), String(tw), '--padColor', bg, tmp, '--out', out]);
rmSync(tmp, { force: true });

console.log(`padded ${sw}x${sh} -> ${tw}x${th} -> ${out}`);
const srcRatio = sw / sh, tgtRatio = tw / th;
if (srcRatio.toFixed(3) !== tgtRatio.toFixed(3)) {
    const bars = srcRatio > tgtRatio ? 'top and bottom' : 'left and right';
    console.log(`WARNING: source ratio ${srcRatio.toFixed(2)} != target ${tgtRatio.toFixed(2)}; letterboxed with bars on ${bars} (bg #${bg}). Capture at ${tw}x${th} to avoid bars.`);
}
