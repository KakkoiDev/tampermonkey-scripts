// Tiny cross-platform secret store: macOS Keychain (`security`) or Linux libsecret (`secret-tool`).
// Secrets are namespaced under the service "cws-publish". Returns undefined when a key is absent or
// no keyring backend is available (e.g. a headless Linux box - use --env-file there instead).
import { execFileSync } from 'node:child_process';

const SERVICE = 'cws-publish';
const ACCT = process.env.USER || process.env.LOGNAME || 'cws';
const MAC = process.platform === 'darwin';
export const backend = MAC ? 'macOS Keychain' : 'libsecret (secret-tool)';

export function getSecret(key) {
    try {
        if (MAC) {
            return execFileSync('security',
                ['find-generic-password', '-a', ACCT, '-s', `${SERVICE}-${key}`, '-w'],
                { encoding: 'utf8' }).trim();
        }
        return execFileSync('secret-tool', ['lookup', 'service', SERVICE, 'key', key],
            { encoding: 'utf8' }).trim();
    } catch {
        return undefined;
    }
}

export function setSecret(key, value) {
    if (MAC) {
        execFileSync('security',
            ['add-generic-password', '-U', '-a', ACCT, '-s', `${SERVICE}-${key}`, '-w', value]);
    } else {
        // secret-tool reads the secret from stdin (never on the command line)
        execFileSync('secret-tool', ['store', '--label', `${SERVICE} ${key}`, 'service', SERVICE, 'key', key],
            { input: value });
    }
}

export function delSecret(key) {
    try {
        if (MAC) {
            execFileSync('security', ['delete-generic-password', '-a', ACCT, '-s', `${SERVICE}-${key}`],
                { stdio: 'ignore' });
        } else {
            execFileSync('secret-tool', ['clear', 'service', SERVICE, 'key', key], { stdio: 'ignore' });
        }
    } catch { /* not present */ }
}
