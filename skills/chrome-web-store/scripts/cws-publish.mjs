#!/usr/bin/env node
// Upload a new zip to an EXISTING Chrome Web Store item and publish it.
// The API automates version UPDATES only - the first item and its store listing (description,
// screenshots, privacy, category) must be created in the dashboard; the API cannot set them.
//
// Env (never commit): CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
// Usage: node cws-publish.mjs <zipPath> [--upload-only] [--target=default|trustedTesters]
import { createReadStream, existsSync } from 'node:fs';
import webstoreUpload from 'chrome-webstore-upload';

const args = process.argv.slice(2);
const zip = args.find((a) => !a.startsWith('--'));
const uploadOnly = args.includes('--upload-only');
const targetArg = args.find((a) => a.startsWith('--target='));
const target = targetArg ? targetArg.split('=')[1] : 'default';

const need = ['CWS_EXTENSION_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'];
const missing = need.filter((k) => !process.env[k]);

if (!zip || !existsSync(zip)) {
    console.error('usage: node cws-publish.mjs <zipPath> [--upload-only] [--target=default|trustedTesters]');
    process.exit(1);
}
if (missing.length) {
    console.error('missing env vars:', missing.join(', '), '\nSee skills/chrome-web-store/SKILL.md (API credentials).');
    process.exit(1);
}

const store = webstoreUpload({
    extensionId: process.env.CWS_EXTENSION_ID,
    clientId: process.env.CWS_CLIENT_ID,
    clientSecret: process.env.CWS_CLIENT_SECRET,
    refreshToken: process.env.CWS_REFRESH_TOKEN,
});

const up = await store.uploadExisting(createReadStream(zip));
console.log('upload:', up.uploadState, up.itemError ? JSON.stringify(up.itemError) : '');
if (up.uploadState === 'FAILURE') process.exit(1);

if (uploadOnly) {
    console.log('uploaded as a draft (not published). Review it in the dashboard, then re-run without --upload-only.');
    process.exit(0);
}

const pub = await store.publish(target);
console.log('publish:', JSON.stringify(pub));
