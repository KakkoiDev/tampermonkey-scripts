// ==UserScript==
// @name         GM_trystero (trystero devtool)
// @namespace    http://tampermonkey.net/
// @icon         data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="5" cy="12" r="3" fill="%230d9488"/><circle cx="19" cy="6" r="3" fill="%230d9488"/><circle cx="19" cy="18" r="3" fill="%230d9488"/><path d="M7 11l9-4M7 13l9 4" stroke="%230d9488" stroke-width="2"/></svg>
// @version      2026.07.24.1
// @description  DevTool: exposes the full trystero P2P API on window.GM_trystero on any page, for console-driven experiments
// @author       KakkoiDev
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

// A thin passthrough, not an opinionated wrapper: it loads trystero and puts the raw module
// exports on window.GM_trystero so you can drive the full API from the console on any page.
// - @grant none => page MAIN world, so import() works and window.GM_trystero is visible in the console.
// - Lazy: trystero is only fetched when you call GM_trystero.load() (or GM_trystero()), not on every page.
// - CSP: import() and trystero's signaling WebSocket obey the page's CSP. On strict-CSP sites
//   (GitHub/Notion/Google) use load({ disableCSP: true }) with the companion "CSP Unlock"
//   extension (extensions/csp-unlock), or enable Tampermonkey's "Modify existing CSP headers".

(function () {
    'use strict';

    const DEFAULT_URL = 'https://esm.sh/trystero@0.25.3';
    const NOCSP_FLAG = '__nocsp';

    // Callable object: GM_trystero(opts) === GM_trystero.load(opts). After load, the module's
    // exports (joinRoom, selfId, getRelaySockets, ...) are copied onto GM_trystero directly.
    function GM_trystero(opts) { return GM_trystero.load(opts); }

    GM_trystero.url = DEFAULT_URL;
    GM_trystero.module = null;
    GM_trystero._loading = null;

    // load()                     -> import trystero (works on CSP-relaxed / already-unlocked pages)
    // load('https://.../x')      -> import from a specific URL (string shorthand for { url })
    // load({ disableCSP: true }) -> reload with the __nocsp=1 flag so the companion "CSP Unlock"
    //                               extension strips this page's CSP, then auto-resume the import
    GM_trystero.load = function load(opts) {
        opts = (typeof opts === 'string') ? { url: opts } : (opts || {});
        if (opts.disableCSP) return GM_trystero.disableCSP();

        if (GM_trystero.module) return Promise.resolve(GM_trystero.module);
        if (GM_trystero._loading) return GM_trystero._loading;

        const target = opts.url || GM_trystero.url;
        GM_trystero._loading = import(target)
            .then((mod) => {
                GM_trystero.module = mod;
                for (const key of Object.keys(mod)) {
                    try { GM_trystero[key] = mod[key]; } catch (e) { /* read-only export, skip */ }
                }
                return mod;
            })
            .catch((e) => {
                console.warn('[GM_trystero] load failed (page CSP likely blocks esm.sh). On a strict site run',
                    'GM_trystero.load({ disableCSP: true }) - needs the CSP Unlock extension installed.', e);
                throw e;
            })
            .finally(() => { GM_trystero._loading = null; });

        return GM_trystero._loading;
    };

    // Reload the page with __nocsp=1 so the companion "CSP Unlock" extension removes the CSP header
    // on that load; the boot logic below then auto-resumes load(). Without the extension the reload
    // just re-applies the same CSP (no harm, but load will still fail).
    GM_trystero.disableCSP = function disableCSP() {
        try {
            const u = new URL(location.href);
            if (u.searchParams.get(NOCSP_FLAG) === '1') return GM_trystero.load();
            u.searchParams.set(NOCSP_FLAG, '1');
            console.warn('[GM_trystero] reloading with CSP disabled (requires the CSP Unlock extension)...');
            location.replace(u.toString());
        } catch (e) {
            console.warn('[GM_trystero] disableCSP failed', e);
        }
        return new Promise(() => {});   // page is navigating away
    };

    GM_trystero.help = function help() {
        const loaded = GM_trystero.module
            ? Object.keys(GM_trystero.module).join(', ')
            : '(not loaded yet - run: await GM_trystero.load())';
        console.log([
            'GM_trystero - the raw trystero API, on window.',
            '',
            'Load:',
            '  await GM_trystero.load()                      import trystero (default: nostr), expose its exports',
            '  await GM_trystero.load({ disableCSP: true })  strict site: reload with CSP stripped (needs CSP Unlock ext), then load',
            "  await GM_trystero.load('https://.../x')       import from a specific esm.sh URL (other strategy/version)",
            '  GM_trystero.module           the raw module namespace once loaded',
            '  GM_trystero.url              default import URL (' + DEFAULT_URL + ')',
            '',
            'Use (after load):',
            "  const room = GM_trystero.joinRoom({ appId: 'demo' }, 'my-room')",
            '  GM_trystero.selfId',
            "  const chat = room.makeAction('chat')",
            "  chat.send('hi')",
            '  chat.onMessage = (data, { peerId }) => console.log(peerId, data)',
            '  room.onPeerJoin = (id) => console.log("join", id)',
            '  room.getPeers(); await room.ping(peerId); room.leave()',
            '',
            'Exposed exports: ' + loaded,
            '',
            'CSP: import() and the signaling wss obey the page CSP. On strict-CSP sites use',
            'load({ disableCSP: true }) with the CSP Unlock extension, or a permissive origin.',
        ].join('\n'));
    };

    window.GM_trystero = GM_trystero;

    // Auto-resume after a load({ disableCSP: true }) reload: on this flagged load the CSP Unlock
    // extension stripped the header, so import() now works. Then drop the flag from the URL.
    try {
        if (new URLSearchParams(location.search).get(NOCSP_FLAG) === '1') {
            GM_trystero.load().catch(() => {});
            const u = new URL(location.href);
            u.searchParams.delete(NOCSP_FLAG);
            history.replaceState(history.state, '', u.toString());
        }
    } catch (e) { /* ignore */ }
})();
