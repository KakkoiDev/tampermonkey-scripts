// ==UserScript==
// @name         Slack Composer Char Count
// @namespace    http://tampermonkey.net/
// @icon         https://app.slack.com/favicon.ico
// @version      2026.06.08.1
// @description  Proactive character countdown for the Slack composer - warns BEFORE the limit (Slack's own counter only appears once you're already over)
// @author       KakkoiDev
// @match        https://app.slack.com/*
// @grant        none
// @license      MIT
// ==/UserScript==

// Slack shows a native counter (.c-texty_input_unstyled__warning) only once you EXCEED the limit -
// it reads "-N" = delete N chars to send. This adds the missing proactive half: how many chars REMAIN,
// shown while you're still under. We count the way Slack serializes (each embed's data-stringify-text +
// text + one newline per line), and we self-calibrate the limit from Slack's own counter the first time
// it appears, so the number stays exact regardless of the workspace's real cap. We hide our badge
// whenever Slack's native counter is up - no point duplicating it.

(function () {
    'use strict';

    const EDITOR = '.ql-editor';
    const NATIVE = '.c-texty_input_unstyled__warning';            // Slack's own over-limit counter ("-N")
    const CONTAINER = '.c-wysiwyg_container, .c-texty_input_unstyled__container';
    const FEFF = /\uFEFF/g;                                       // Quill's zero-width embed anchors
    let limit = 6821;            // empirical default (the at-the-wall sample message); refined live from NATIVE
    const SHOW_FROM = 1000;      // start showing once the message is this long - earlier than Slack, not on every reply
    const WARN_AT = 500;         // amber when this few remain

    const fmt = (n) => n.toLocaleString('en-US');

    // Slack-serialization length of a subtree: text as-is, every embed as its data-stringify-text.
    function nodeLen(node) {
        let n = 0;
        for (const c of node.childNodes) {
            if (c.nodeType === Node.TEXT_NODE) n += c.textContent.replace(FEFF, '').length;
            else if (c.nodeType === Node.ELEMENT_NODE) {
                const s = c.getAttribute('data-stringify-text');
                n += s != null ? s.length : nodeLen(c);
            }
        }
        return n;
    }
    function messageLength(editor) {
        const lines = editor.querySelectorAll('p');
        if (!lines.length) return nodeLen(editor);
        let total = 0;
        lines.forEach((p, i) => { total += (i ? 1 : 0) + nodeLen(p); });   // one newline between lines
        return total;
    }

    // Slack's native overage for this editor (positive = chars over), or null when under the limit.
    function nativeOver(editor) {
        const scope = editor.closest(CONTAINER);
        const el = (scope && scope.querySelector(NATIVE)) || document.querySelector(NATIVE);
        if (!el) return null;
        const m = (el.textContent || '').replace(/[,\s]/g, '').match(/-(\d+)/);
        return m ? parseInt(m[1], 10) : null;
    }

    const badge = document.createElement('div');
    badge.style.cssText = [
        'position:fixed', 'z-index:9999', 'pointer-events:none', 'display:none',
        'padding:1px 7px', 'border-radius:9px', 'font:12px/1.6 monospace',
        'background:rgba(0,0,0,.6)', 'white-space:nowrap',
    ].join(';');
    (document.body || document.documentElement).appendChild(badge);

    let activeEditor = null, obs = null, raf = 0;
    const hide = () => { badge.style.display = 'none'; };

    function place(editor) {
        const r = editor.getBoundingClientRect();
        badge.style.left = Math.max(4, r.right - badge.offsetWidth - 8) + 'px';
        badge.style.top = (r.bottom - badge.offsetHeight - 6) + 'px';
    }

    function refresh() {
        if (!activeEditor || !activeEditor.isConnected) return hide();
        const over = nativeOver(activeEditor);
        const len = messageLength(activeEditor);
        if (over != null) {                       // over the limit: Slack shows its own "-N" - calibrate, then defer
            limit = len - over;
            return hide();
        }
        if (len < SHOW_FROM) return hide();
        const remaining = limit - len;
        if (remaining < 0) {                      // fallback only (native not detected): we're past the cap
            badge.textContent = `${fmt(-remaining)} over`;
            badge.style.color = '#ff8a8a';
        } else {
            badge.textContent = `${fmt(remaining)} left`;
            badge.style.color = remaining <= WARN_AT ? '#ffd479' : '#cfd3d7';
        }
        badge.style.display = 'block';
        place(activeEditor);
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; refresh(); }); };

    function attach(editor) {
        if (obs) obs.disconnect();
        activeEditor = editor;
        obs = new MutationObserver(schedule);
        obs.observe(editor, { childList: true, subtree: true, characterData: true });
        schedule();
    }

    document.addEventListener('focusin', (e) => {
        const ed = e.target.closest(EDITOR);
        if (ed) attach(ed);
    });
    document.addEventListener('focusout', (e) => {
        if (!e.target.closest(EDITOR)) return;
        setTimeout(() => {
            if (!document.activeElement || !document.activeElement.closest(EDITOR)) {
                if (obs) { obs.disconnect(); obs = null; }
                activeEditor = null;
                hide();
            }
        }, 0);
    });
    window.addEventListener('scroll', () => { if (activeEditor && badge.style.display !== 'none') place(activeEditor); }, true);
    window.addEventListener('resize', schedule);
})();
