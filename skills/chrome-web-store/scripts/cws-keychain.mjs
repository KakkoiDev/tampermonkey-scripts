#!/usr/bin/env node
// Store / inspect / remove the Chrome Web Store API credentials in the OS keyring (macOS Keychain
// or Linux libsecret), so publishing needs no env file and no copy-paste. `store` reads the values
// from the current environment - it never takes them on the command line.
//
//   CWS_CLIENT_ID=.. CWS_CLIENT_SECRET=.. CWS_REFRESH_TOKEN=.. [CWS_EXTENSION_ID=..] \
//     node cws-keychain.mjs store
//   node cws-keychain.mjs check   # show which keys are present (never prints values)
//   node cws-keychain.mjs clear   # remove them
import { getSecret, setSecret, delSecret, backend } from './keyring.mjs';

const KEYS = ['CWS_EXTENSION_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'];
const cmd = process.argv[2];

if (cmd === 'store') {
    const present = KEYS.filter((k) => process.env[k]);
    if (!present.length) {
        console.error('Set the CWS_* vars in this shell first (at least CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN).');
        process.exit(1);
    }
    for (const k of present) { setSecret(k, process.env[k]); console.log('stored', k); }
    console.log(`saved to ${backend}; cws-publish.mjs will read them automatically.`);
} else if (cmd === 'check') {
    console.log(`backend: ${backend}`);
    for (const k of KEYS) console.log(`  ${getSecret(k) ? 'present' : 'missing '}  ${k}`);
} else if (cmd === 'clear') {
    for (const k of KEYS) { delSecret(k); console.log('removed', k); }
} else {
    console.log('usage: node cws-keychain.mjs store|check|clear');
    console.log(`backend: ${backend}`);
    process.exit(cmd ? 1 : 0);
}
