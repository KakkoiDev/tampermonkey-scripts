// ==UserScript==
// @name         Gmeet++
// @namespace    http://tampermonkey.net/
// @version      2026.07.21.2
// @license      MIT
// @description  Add nice-to-have features to Gmeet meetings
// @author       KakkoiDev
// @match        https://meet.google.com/*
// @match        https://chat.google.com/embed/*
// @icon         https://meet.google.com/favicon.ico
// @grant        none
// ==/UserScript==

/**
 * Gmeet++ adds new features to Gmeet.
 * Features:
 * - 1. Automatically mute mic & camera when joining (fires in the pre-join room too).
 * - 2. Invert colors button on the video grid.
 * - 3. Random participant order list -> chat.
 * - 4. Random single participant pick -> chat.
 * - 5. Promote Gmeet++ -> chat.
 *
 * UI: a single round button docked in Meet's native bottom toolbar. Clicking it opens a
 * dark rounded popup with the feature actions. The button re-injects itself whenever Meet
 * rebuilds the bar.
 *
 * Chat posting: Google moved in-meeting chat into a cross-origin chat.google.com iframe,
 * so the Meet page cannot reach the composer. This script ALSO runs inside that iframe
 * (second @match); the two halves talk over postMessage. The Meet half posts the text to
 * the frame; the in-frame half types it into the composer and clicks send (Enter
 * fallback). If the frame doesn't acknowledge (not injected / DOM changed), the Meet half
 * falls back to copying the text to the clipboard and opening chat so the user can paste.
 *
 * Names are read from the video-grid tiles (present while the People panel is closed),
 * falling back to the open People panel. Only entries with data-participant-id count.
 */

(function () {
    'use strict';

    const DEBUG = true;
    const GMPP_TOKEN = 'gmpp-bridge-1'; // namespaces our postMessages; origin checks are the real guard
    const MEET_ORIGIN = 'https://meet.google.com';
    const CHAT_ORIGIN = 'https://chat.google.com';
    const handledSends = new Set(); // in-frame: dedup retried send requests by id (declared before the frame branch)

    // When injected inside the chat.google.com iframe, act only as the send agent.
    if (location.hostname === 'chat.google.com') {
        initChatFrameAgent();
        return;
    }

    // ------------------------------------------------------------------ (Meet page below)

    // Meet DOM hooks. Anchored on data-* / role / jsname (locale-independent), never
    // hashed presentational classes.
    const SEL = {
        micButton: 'button[jsname="hw0c9"]', // mic toggle (pre-join + in-call); state in data-is-muted
        camButton: 'button[jsname="psRWwc"]', // camera toggle (pre-join + in-call); state in data-is-muted
        muteButtonLegacy: '[data-mute-button]', // fallback for older Meet ([0]=audio, [1]=video)
        header: "[data-side='1']", // its nextElementSibling is the video grid
        peoplePanel: 'div[data-panel-id="1"]', // People panel container (once open)
        chatPanel: 'div[data-panel-id="2"]', // Chat panel container
        chatToggle: 'button[data-panel-id="2"]', // Chat toggle; open state in aria-expanded
        chatIframe: 'iframe[src*="chat.google.com"]', // the cross-origin chat embed
        tile: '[data-participant-id]:not([role="listitem"])', // a video-grid tile
        panelItem: '[role="listitem"][data-participant-id]', // an in-call participant row (excludes invited guests)
        // bottom-toolbar buttons (jsname, locale-independent)
        moreOptions: 'button[jsname="NakZHc"]',
        leave: 'button[jsname="CQylAd"]',
        reactions: 'button[jsname="G0pghc"]',
        raiseHand: 'button[jsname="FpSaz"]',
    };

    const THEME = {
        surface: '#282a2d', // Meet dark popup surface
        text: '#e3e3e3',
        hover: 'rgba(255,255,255,.10)',
        radius: '12px',
        font: "'Google Sans',Roboto,system-ui,sans-serif",
    };

    // Auto-mute is enforced by polling (see the setInterval driver), NOT a MutationObserver:
    // Meet flips data-is-muted via attribute changes childList observation misses, and it can
    // reset the button to unmuted shortly AFTER our click during media init. So we keep
    // re-muting (with a cooldown) until the muted state has HELD for MUTE_STABLE_MS, then
    // latch and never fight the user again.
    const MUTE_RETRY_MS = 600;
    const MUTE_STABLE_MS = 1500;
    const MUTE_MAX_TRIES = 60;
    const muteCtl = {
        mic: { done: false, mutedSince: 0, lastClick: 0, tries: 0 },
        cam: { done: false, mutedSince: 0, lastClick: 0, tries: 0 },
    };

    let isVideoGridInverted = false;
    let toastTimer = 0;

    // ---------------------------------------------------------------- styling

    function injectStyle() {
        if (document.getElementById('gmpp-style')) return;
        const style = document.createElement('style');
        style.id = 'gmpp-style';
        style.textContent = `
.gmpp-cell { display: inline-flex; align-items: center; }
#gmpp-toolbar-btn.gmpp-tbtn {
    all: unset;
    box-sizing: border-box;
    width: 48px; height: 48px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 50%;
    color: ${THEME.text};
    cursor: pointer;
    transition: background-color .15s;
}
#gmpp-toolbar-btn.gmpp-tbtn:hover { background: ${THEME.hover}; }
.gmpp-icon { font-size: 24px; line-height: 1; }
.gmpp-popup {
    position: fixed;
    z-index: 2147483000;
    min-width: 240px;
    padding: 8px;
    background: ${THEME.surface};
    color: ${THEME.text};
    border-radius: ${THEME.radius};
    box-shadow: 0 4px 16px rgba(0,0,0,.5);
    font-family: ${THEME.font};
    display: none;
}
.gmpp-popup.gmpp-open { display: block; }
.gmpp-item {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    display: flex; align-items: center; gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    color: ${THEME.text};
}
.gmpp-item:hover { background: ${THEME.hover}; }
.gmpp-item .gmpp-icon { font-size: 20px; }
.gmpp-toast {
    position: fixed;
    left: 50%;
    bottom: 96px;
    transform: translateX(-50%) translateY(8px);
    z-index: 2147483000;
    max-width: 80vw;
    padding: 10px 16px;
    background: ${THEME.surface};
    color: ${THEME.text};
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,.5);
    font: 14px/1.4 ${THEME.font};
    opacity: 0;
    pointer-events: none;
    transition: opacity .2s, transform .2s;
}
.gmpp-toast.gmpp-toast-show { opacity: 1; transform: translateX(-50%) translateY(0); }
`;
        (document.head || document.documentElement).appendChild(style);
    }

    // ---------------------------------------------------------------- helpers

    const qs = (sel) => document.querySelector(sel);

    // DEBUG tracing. The in-frame agent posts {type:'diag'} to us, so both sides' events
    // surface in the ONE Meet-tab console. Temporary - flip DEBUG off before shipping.
    function diag(...a) { if (DEBUG) console.log('[Gmeet++]', ...a); }
    if (DEBUG) window.addEventListener('message', (e) => {
        if (e.origin !== CHAT_ORIGIN) return;
        const d = e.data;
        if (d && d.gmpp === GMPP_TOKEN && d.type === 'diag') console.log('[Gmeet++ frame]', d.msg);
    });

    function lowestCommonAncestor(a, b) {
        const ancestors = new Set();
        for (let n = a; n; n = n.parentElement) ancestors.add(n);
        for (let n = b; n; n = n.parentElement) if (ancestors.has(n)) return n;
        return null;
    }

    function cellUnder(row, node) {
        let n = node;
        while (n && n.parentElement !== row) n = n.parentElement;
        return n;
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* ignore */ }
        ta.remove();
    }

    function toast(msg) {
        let el = document.getElementById('gmpp-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'gmpp-toast';
            el.className = 'gmpp-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('gmpp-toast-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('gmpp-toast-show'), 3000);
    }

    // ---------------------------------------------------------------- chat posting

    // Native in-page composer (older / non-space meetings). Returns true if it sent.
    function tryNativeSend(message) {
        const panel = qs(SEL.chatPanel);
        const textarea = panel?.querySelector('textarea');
        const sendButton = textarea?.parentNode?.parentNode?.nextElementSibling?.querySelector('button');
        if (textarea && sendButton) {
            textarea.focus();
            document.execCommand('insertText', false, message);
            sendButton.click();
            return true;
        }
        return false;
    }

    // Post the message to the in-frame agent, retrying until it acks. The `post` closure
    // RE-QUERIES the iframe every tick, so a chat panel that is still opening (cold start:
    // the iframe element and the chat.google.com app appear several seconds after the toggle
    // click) is picked up as soon as it exists - no premature bail-out. Retries share one id;
    // the agent dedups on it, so no duplicate sends. Clipboard-fallback on a failed ack or
    // the overall timeout.
    function bridgeSend(message) {
        const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
        let done = false;
        diag('bridgeSend start id=' + id.slice(-4));
        const finish = (fn) => {
            if (done) return;
            done = true;
            window.removeEventListener('message', onAck);
            clearInterval(poll);
            clearTimeout(timer);
            if (fn) fn();
        };
        const onAck = (e) => {
            if (e.origin !== CHAT_ORIGIN) return;
            const d = e.data;
            if (!d || d.gmpp !== GMPP_TOKEN || d.type !== 'send-ack' || d.id !== id) return;
            diag('bridge ack ok=' + d.ok + ' manual=' + d.manual);
            if (!d.ok) finish(() => fallbackClipboard(message));
            else if (d.manual) finish(() => toast('Message typed in chat - press Enter to send.'));
            else finish(null);
        };
        window.addEventListener('message', onAck);
        let posts = 0, foundLogged = false;
        const post = () => {
            posts++;
            const iframe = qs(SEL.chatIframe);
            if (iframe && !foundLogged) { foundLogged = true; diag('iframe found after ~' + (posts * 250) + 'ms, contentWindow=' + !!iframe.contentWindow); }
            iframe?.contentWindow?.postMessage({ gmpp: GMPP_TOKEN, type: 'send', id, text: message }, CHAT_ORIGIN);
        };
        post();
        const poll = setInterval(post, 250); // re-find the iframe + re-post until the agent acks
        const timer = setTimeout(() => finish(() => {
            diag('bridge TIMEOUT 20s (iframeEverFound=' + foundLogged + ') -> clipboard');
            fallbackClipboard(message);
        }), 20000); // generous: cold chat open + app load + agent inject can take many seconds
    }

    function fallbackClipboard(message) {
        const chatToggle = qs(SEL.chatToggle);
        const open = chatToggle && (chatToggle.getAttribute('aria-expanded') ?? chatToggle.getAttribute('aria-pressed'));
        if (chatToggle && open === 'false') chatToggle.click();
        copyToClipboard(message);
        toast('Copied. Paste into chat with ⌘/Ctrl+V.');
    }

    function postToChat(message) {
        if (tryNativeSend(message)) { diag('native send used'); return; }
        // Open chat so the iframe gets created; bridgeSend re-queries it, so it tolerates the
        // panel still opening (the cold-start case).
        const chatToggle = qs(SEL.chatToggle);
        const open = chatToggle && (chatToggle.getAttribute('aria-expanded') ?? chatToggle.getAttribute('aria-pressed'));
        diag('postToChat cold=' + (open === 'false') + ' toggleFound=' + !!chatToggle + ' openAttr=' + open);
        if (chatToggle && open === 'false') chatToggle.click();
        bridgeSend(message);
    }

    // ---------------------------------------------------------------- participants

    function nameFromTile(tile) {
        for (const s of tile.querySelectorAll('span.notranslate')) {
            const t = s.textContent.trim();
            if (t) return t;
        }
        return null;
    }

    function getParticipantsNameList() {
        const panel = qs(SEL.peoplePanel);
        if (panel) {
            const names = [...panel.querySelectorAll(SEL.panelItem)]
                .map((li) => li.getAttribute('aria-label'))
                .filter(Boolean);
            if (names.length) return [...new Set(names)];
        }
        const names = [...document.querySelectorAll(SEL.tile)].map(nameFromTile).filter(Boolean);
        return [...new Set(names)];
    }

    function randomizeList(list) {
        if (!Array.isArray(list)) throw new Error('Given list is not an array!');
        return list.map((value) => ({ value, sort: Math.random() })).sort((a, b) => a.sort - b.sort).map((x) => x.value);
    }

    // ---------------------------------------------------------------- feature actions

    function toggleInvert() {
        const grid = qs(SEL.header)?.nextElementSibling;
        if (!grid) return;
        isVideoGridInverted = !isVideoGridInverted;
        grid.style.filter = isVideoGridInverted ? 'invert(1)' : 'invert(0)';
    }

    function generateRandomList() {
        const names = randomizeList(getParticipantsNameList());
        if (!names.length) { toast('No participants found.'); return; }
        let text = '';
        for (const [index, name] of names.entries()) text += `${index + 1}. ${name}\n`;
        postToChat(text);
    }

    function getRandomParticipant() {
        const names = randomizeList(getParticipantsNameList());
        if (!names.length) { toast('No participants found.'); return; }
        postToChat(names[0]);
    }

    function promote() {
        postToChat('📨 Gmeet++\nAdd the features you miss to Gmeet!\nInstall: https://greasyfork.org/en/scripts/513815-gmeet');
    }

    // ---------------------------------------------------------------- popup

    function positionPopup(popup, btn) {
        const r = btn.getBoundingClientRect();
        popup.style.left = 'auto';
        popup.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
        popup.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    }

    function togglePopup() {
        const popup = document.getElementById('gmpp-popup');
        const btn = document.getElementById('gmpp-toolbar-btn');
        if (!popup || !btn) return;
        if (popup.classList.contains('gmpp-open')) {
            popup.classList.remove('gmpp-open');
        } else {
            positionPopup(popup, btn);
            popup.classList.add('gmpp-open');
        }
    }

    function buildPopup() {
        if (document.getElementById('gmpp-popup')) return;

        const popup = document.createElement('div');
        popup.id = 'gmpp-popup';
        popup.className = 'gmpp-popup';

        const items = [
            { icon: 'invert_colors', label: 'Invert colors', onClick: toggleInvert },
            { icon: 'format_list_numbered', label: 'Random order list', onClick: generateRandomList },
            { icon: 'casino', label: 'Pick random person', onClick: getRandomParticipant },
            { icon: 'campaign', label: 'Promote Gmeet++', onClick: promote },
        ];

        for (const it of items) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'gmpp-item';
            const icon = document.createElement('i');
            icon.className = 'google-symbols notranslate gmpp-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = it.icon;
            const span = document.createElement('span');
            span.textContent = it.label;
            button.appendChild(icon);
            button.appendChild(span);
            button.addEventListener('click', () => {
                popup.classList.remove('gmpp-open');
                try {
                    it.onClick();
                } catch (e) {
                    console.error('[Gmeet++]', it.label, e);
                    toast('Something went wrong - see console.');
                }
            });
            popup.appendChild(button);
        }

        document.body.appendChild(popup);

        document.addEventListener('click', (e) => {
            if (!popup.classList.contains('gmpp-open')) return;
            const btn = document.getElementById('gmpp-toolbar-btn');
            if (popup.contains(e.target) || (btn && btn.contains(e.target))) return;
            popup.classList.remove('gmpp-open');
        }, true);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') popup.classList.remove('gmpp-open');
        });
    }

    // ---------------------------------------------------------------- toolbar button (self-healing)

    function ensureToolbarButton() {
        if (document.getElementById('gmpp-toolbar-btn')) return; // getElementById never returns detached nodes

        const moreBtn = qs(SEL.moreOptions);
        const secondBtn = qs(SEL.leave) || qs(SEL.raiseHand) || qs(SEL.reactions);
        if (!moreBtn || !secondBtn) return;

        const row = lowestCommonAncestor(moreBtn, secondBtn);
        const refCell = row && cellUnder(row, moreBtn);
        if (!row || !refCell) return;

        const cell = document.createElement('div');
        cell.className = 'gmpp-cell';

        const btn = document.createElement('button');
        btn.id = 'gmpp-toolbar-btn';
        btn.className = 'gmpp-tbtn';
        btn.type = 'button';
        btn.title = 'Gmeet++';
        btn.setAttribute('aria-label', 'Gmeet++');

        const icon = document.createElement('i');
        icon.className = 'google-symbols notranslate gmpp-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = 'extension';
        btn.appendChild(icon);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopup();
        });

        cell.appendChild(btn);
        row.insertBefore(cell, refCell);

        if (DEBUG) console.log('[Gmeet++] toolbar button injected');
    }

    // ---------------------------------------------------------------- auto-mute

    function findMuteButtons() {
        let mic = qs(SEL.micButton);
        let cam = qs(SEL.camButton);
        if (!mic || !cam) {
            const legacy = document.querySelectorAll(SEL.muteButtonLegacy);
            mic = mic || legacy?.[0];
            cam = cam || legacy?.[1];
        }
        return { mic, cam };
    }

    function enforceMute(btn, st, label, now) {
        if (!btn) return;
        const muted = btn.getAttribute('data-is-muted');
        if (muted === 'true') {
            if (!st.mutedSince) st.mutedSince = now;
            if (!st.done && now - st.mutedSince >= MUTE_STABLE_MS) {
                st.done = true;
                if (DEBUG) console.log('[Gmeet++]', label, 'muted stable -> latched');
            }
        } else if (muted === 'false') {
            st.mutedSince = 0;
            if (!st.done && st.tries < MUTE_MAX_TRIES && now - st.lastClick > MUTE_RETRY_MS) {
                btn.click();
                st.lastClick = now;
                st.tries++;
                if (DEBUG) console.log('[Gmeet++]', label, 'click to mute, try', st.tries);
            }
        }
    }

    function autoMute() {
        const now = Date.now();
        const { mic, cam } = findMuteButtons();
        enforceMute(mic, muteCtl.mic, 'mic', now);
        enforceMute(cam, muteCtl.cam, 'cam', now);
    }

    // ---------------------------------------------------------------- init & loop (Meet page)

    function tick() {
        injectStyle();
        buildPopup();
        ensureToolbarButton();
        autoMute();
    }

    tick();
    setInterval(tick, 300); // steady poll: enforces auto-mute reliably and self-heals the toolbar button

    // ---------------------------------------------------------------- in-frame chat agent
    // Runs ONLY inside the chat.google.com iframe (hoisted; called from the hostname branch).

    // DEBUG: report the agent's own events up to the Meet page so they land in one console.
    function frameDiag(msg) {
        if (!DEBUG) return;
        try { window.parent.postMessage({ gmpp: GMPP_TOKEN, type: 'diag', msg }, MEET_ORIGIN); } catch (e) { /* ignore */ }
        console.log('[Gmeet++ frame]', msg);
    }

    function initChatFrameAgent() {
        window.addEventListener('message', (e) => {
            if (e.origin !== MEET_ORIGIN) return;
            const d = e.data;
            if (!d || d.gmpp !== GMPP_TOKEN || d.type !== 'send') return;
            frameDiag('recv send id=' + (d.id || '').slice(-4) + (handledSends.has(d.id) ? ' (dup, skip)' : ''));
            if (d.id && handledSends.has(d.id)) return; // dedup retried posts -> send once
            if (d.id) handledSends.add(d.id);
            trySendInFrame(d.text).then((status) => {
                frameDiag('ack ' + status + ' id=' + (d.id || '').slice(-4));
                try { e.source?.postMessage({ gmpp: GMPP_TOKEN, type: 'send-ack', id: d.id, ok: status !== 'failed', manual: status === 'manual' }, e.origin); } catch (err) { /* ignore */ }
            });
        });
        frameDiag('agent ready @ ' + location.href.slice(0, 55));
    }

    // Wait for the composer to exist (Chat renders it async after the frame loads), then
    // insert + send. Resolves true if the text landed, false otherwise (-> clipboard).
    function trySendInFrame(text) {
        return new Promise((resolve) => {
            const start = Date.now();
            const attempt = () => {
                const box = document.querySelector('[contenteditable="true"][role="textbox"]');
                if (box) { frameDiag('composer found @' + (Date.now() - start) + 'ms'); insertAndSend(box, text).then(resolve); return; }
                if (Date.now() - start > 8000) { frameDiag('composer NEVER appeared (8s)'); resolve('failed'); return; }
                setTimeout(attempt, 150);
            };
            attempt();
        });
    }

    // Put `text` into Chat's composer and send. Resolves:
    //   'sent'   - clicked the enabled Send button
    //   'manual' - text is in the box but Send never enabled; caller tells the user to press
    //              Enter (Chat ignores untrusted synthetic Enter, so we never fake it)
    //   'failed' - text never landed at all
    // Verified against the real Chat editor (Lexical): execCommand insertText AND a simulated
    // paste both register in its model and ENABLE the Send button - but only once the editor
    // is initialised. On a cold composer (embed just booted) the first insert can run too
    // early and not register, so Send never enables. Fix: RE-INSERT (clear first) every ~1.2s
    // until Send enables, then click. Grounded in the fact that the insert works once ready.
    function insertAndSend(box, text) {
        return new Promise((resolve) => {
            const sendBtn = () => document.querySelector('button[jsname="GBTyxb"]');
            const focusEnd = () => {
                try {
                    box.focus();
                    const r = document.createRange(); r.selectNodeContents(box); r.collapse(false);
                    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
                } catch (err) { /* ignore */ }
            };
            const clearBox = () => { try { box.focus(); document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); } catch (err) { /* ignore */ } };
            const doInsert = () => {
                focusEnd();
                try { document.execCommand('insertText', false, text); } catch (err) { /* ignore */ }
                if (!box.textContent || !box.textContent.trim()) {
                    try { const dt = new DataTransfer(); dt.setData('text/plain', text); box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); } catch (err) { /* ignore */ }
                }
                return !!(box.textContent || '').trim();
            };

            let attempts = 1;
            frameDiag('insert attempt 1 landed=' + doInsert());
            let lastInsert = Date.now();
            const deadline = Date.now() + 5000;
            const tick = () => {
                const b = sendBtn();
                if (b && !b.disabled) { b.click(); frameDiag('clicked send button (attempt ' + attempts + ')'); resolve('sent'); return; }
                // Send still disabled: if a beat has passed the editor didn't register our text
                // (cold) - clear and re-insert.
                if (Date.now() - lastInsert > 1200 && attempts < 4) {
                    clearBox();
                    attempts++;
                    frameDiag('re-insert attempt ' + attempts + ' landed=' + doInsert());
                    lastInsert = Date.now();
                }
                if (Date.now() < deadline) { setTimeout(tick, 250); return; }
                const landed = !!(box.textContent || '').trim();
                frameDiag('send never enabled in 5s -> ' + (landed ? 'manual' : 'failed'));
                resolve(landed ? 'manual' : 'failed');
            };
            setTimeout(tick, 250);
        });
    }
})();
