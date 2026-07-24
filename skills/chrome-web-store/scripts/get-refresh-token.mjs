#!/usr/bin/env node
// One-off: obtain a Chrome Web Store API refresh token via the OAuth loopback flow. No deps.
// Prereq: a Google Cloud OAuth 2.0 Client ID of type "Desktop", in a project with the
// "Chrome Web Store API" enabled, and an OAuth consent screen set to "In production"
// (Testing-mode refresh tokens expire after 7 days).
// Usage: CWS_CLIENT_ID=... CWS_CLIENT_SECRET=... node get-refresh-token.mjs
import http from 'node:http';
import { execFile } from 'node:child_process';

const clientId = process.env.CWS_CLIENT_ID || process.argv[2];
const clientSecret = process.env.CWS_CLIENT_SECRET || process.argv[3];
if (!clientId || !clientSecret) {
    console.error('usage: CWS_CLIENT_ID=... CWS_CLIENT_SECRET=... node get-refresh-token.mjs');
    process.exit(1);
}

const PORT = 8976;
const redirectUri = `http://localhost:${PORT}`;
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/chromewebstore',
    access_type: 'offline',
    prompt: 'consent',
}).toString();

const server = http.createServer(async (req, res) => {
    const code = new URL(req.url, redirectUri).searchParams.get('code');
    if (!code) { res.writeHead(400); res.end('no ?code in request'); return; }
    try {
        const r = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code, client_id: clientId, client_secret: clientSecret,
                redirect_uri: redirectUri, grant_type: 'authorization_code',
            }),
        });
        const j = await r.json();
        if (j.refresh_token) {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('Got the refresh token - return to your terminal.');
            console.log('\nCWS_REFRESH_TOKEN=' + j.refresh_token);
            console.log('\nExport it with CWS_CLIENT_ID / CWS_CLIENT_SECRET / CWS_EXTENSION_ID, then run cws-publish.mjs.');
        } else {
            res.writeHead(500, { 'content-type': 'text/plain' });
            res.end('No refresh_token returned - see the terminal.');
            console.error('token response:', JSON.stringify(j, null, 2));
        }
    } catch (e) {
        res.writeHead(500); res.end('error'); console.error(e);
    } finally {
        setTimeout(() => server.close(() => process.exit(0)), 300);
    }
});

server.listen(PORT, () => {
    console.log('Open this URL, sign in with the publisher account, and grant access:\n\n' + authUrl + '\n');
    execFile('open', [authUrl], () => { /* macOS convenience; ignore if unavailable */ });
});
