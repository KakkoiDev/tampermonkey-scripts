#!/usr/bin/env node
// Upload a new zip to an EXISTING Chrome Web Store item and publish it.
// The API automates version UPDATES only - the first item and its store listing (description,
// screenshots, privacy, category) must be created in the dashboard; the API cannot set them.
//
// Credentials resolve from the environment, then the macOS login Keychain (stored once by
// cws-keychain.mjs) - so the secrets (client secret, refresh token) never sit in a file or the
// command line. The extension ID is public: pass --id=<extId>, or let it come from env/Keychain.
// Usage: node cws-publish.mjs <zipPath> [--id=<extId>] [--upload-only] [--target=default|trustedTesters]
import { createReadStream, existsSync } from 'node:fs';
import webstoreUpload from 'chrome-webstore-upload';
import { getSecret } from './keyring.mjs';

const args = process.argv.slice(2);
const zip = args.find((a) => !a.startsWith('--'));
const uploadOnly = args.includes('--upload-only');
const targetArg = args.find((a) => a.startsWith('--target='));
const target = targetArg ? targetArg.split('=')[1] : 'default';
const idArg = args.find((a) => a.startsWith('--id='));

const cred = (key) => process.env[key] || getSecret(key);

const extensionId = (idArg ? idArg.split('=')[1] : null) || cred('CWS_EXTENSION_ID');
const clientId = cred('CWS_CLIENT_ID');
const clientSecret = cred('CWS_CLIENT_SECRET');
const refreshToken = cred('CWS_REFRESH_TOKEN');

if (!zip || !existsSync(zip)) {
    console.error('usage: node cws-publish.mjs <zipPath> [--id=<extId>] [--upload-only] [--target=default|trustedTesters]');
    process.exit(1);
}
const missing = [
    ['CWS_EXTENSION_ID', extensionId], ['CWS_CLIENT_ID', clientId],
    ['CWS_CLIENT_SECRET', clientSecret], ['CWS_REFRESH_TOKEN', refreshToken],
].filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
    console.error('missing creds:', missing.join(', '),
        '\nStore them once: node skills/chrome-web-store/scripts/cws-keychain.mjs store  (or set env / pass --id).');
    process.exit(1);
}

const store = webstoreUpload({ extensionId, clientId, clientSecret, refreshToken });

const up = await store.uploadExisting(createReadStream(zip));
console.log('upload:', up.uploadState, up.itemError ? JSON.stringify(up.itemError) : '');
if (up.uploadState === 'FAILURE') process.exit(1);

if (uploadOnly) {
    console.log('uploaded as a draft (not published). Review it in the dashboard, then re-run without --upload-only.');
    process.exit(0);
}

const pub = await store.publish(target);
console.log('publish:', JSON.stringify(pub));
