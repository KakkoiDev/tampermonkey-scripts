// ==UserScript==
// @name         GitHub PR Copy Diff
// @namespace    http://tampermonkey.net/
// @icon         https://github.githubassets.com/favicons/favicon-dark.png
// @version      2026.06.19
// @description  Adds a "Copy Diff" button to the PR nav that copies the unified diff to the clipboard
// @author       KakkoiDev
// @match        https://github.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      github.com
// @connect      githubusercontent.com
// @license      MIT
// ==/UserScript==

// Broad @match needed: GitHub uses SPA navigation, so the MutationObserver
// re-adds the button as the PR header re-renders.
//
// GM_xmlhttpRequest + GM_setClipboard (not fetch + navigator.clipboard):
// github.com/<o>/<r>/pull/<n>.diff 302-redirects cross-origin to
// patch-diff.githubusercontent.com with no CORS header, so a page fetch is
// blocked. GM_xmlhttpRequest bypasses CORS and sends cookies (private PRs).

(function() {
    'use strict';

    // === OPEN BUG + DIAGNOSTICS - do NOT commit/release to Greasy Fork as-is (logs to every user's console) ===
    // Symptom (reported 2026-06-18): the "Copy Diff" button vanishes when GitHub re-renders the PR
    //   header (e.g. switching tabs) and does not come back.
    // Status: NOT reproduced yet. Single instance self-heals - the log shows the button briefly removed
    //   on the first re-render then re-added (INSERTED, btns=1, visible=1) and stable across /changes,
    //   /commits, /checks, /pull/N. The earlier "two copies fighting (GF install + dev loader)" guess
    //   was WRONG - user confirmed only one instance was running.
    // Still open: some re-render / scroll (sticky header?) / browser-tab-switch path leaves it gone.
    // This logging stays ON in the dev loader to capture the next occurrence. Read the [copy-diff] lines
    //   around the moment it disappears:
    //     "skip: no filesTab"                     -> the Files-tab selector stopped matching the new header
    //     "skip: btn already exists" + visible=0  -> button detached/hidden, but the GLOBAL getElementById
    //                                                guard blocks re-adding it to the visible nav (lead suspect)
    //     btns 1 -> 0 with no following INSERTED   -> the observer/re-add never fired for that mutation
    //     filesTabs=2                             -> a second (sticky?) tab nav exists; button is in the wrong one
    // Likely fix once confirmed: drop the global getElementById guard; keep a button adjacent to the
    //   CURRENTLY VISIBLE Files tab and remove any stray/detached copies.
    const DEBUG = true;
    let _dbgLast = '';
    function dbg(action) {
        if (!DEBUG) return;
        const filesTabs = document.querySelectorAll('#prs-files-anchor-tab, a[href*="/pull/"][href$="/files"]').length;
        const all = [...document.querySelectorAll('#gh-copy-diff-btn')];
        const sig = `${action} | path=${location.pathname} filesTabs=${filesTabs} btns=${all.length} visible=${all.filter((b) => b.offsetParent !== null).length}`;
        if (sig === _dbgLast) return;   // the observer fires constantly; only log when the state changes
        _dbgLast = sig;
        console.log('[copy-diff]', sig);
    }
    // === END TEMP DEBUG ===

    function getPrInfo() {
        const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (!m) return null;
        return { owner: m[1], repo: m[2], number: m[3] };
    }

    function flash(btn, msg) {
        btn.textContent = msg;
        btn.disabled = false;
        setTimeout(() => { btn.textContent = 'Copy Diff'; }, 1500);
    }

    function copyDiff(btn) {
        const pr = getPrInfo();
        if (!pr) return;
        const diffUrl = `${location.origin}/${pr.owner}/${pr.repo}/pull/${pr.number}.diff`;
        btn.disabled = true;
        btn.textContent = 'Copying...';
        GM_xmlhttpRequest({
            method: 'GET',
            url: diffUrl,
            onload: (res) => {
                if (res.status >= 200 && res.status < 300) {
                    GM_setClipboard(res.responseText, 'text');
                    flash(btn, 'Copied!');
                } else {
                    flash(btn, 'Failed');
                }
            },
            onerror: () => flash(btn, 'Failed'),
        });
    }

    function addCopyDiffButton() {
        const pr = getPrInfo();
        if (!pr) return;

        const filesTab = document.querySelector('#prs-files-anchor-tab')
            || document.querySelector(`a[href$="/pull/${pr.number}/files"]`);
        if (!filesTab) { dbg('skip: no filesTab'); return; }
        if (document.getElementById('gh-copy-diff-btn')) { dbg('skip: btn already exists'); return; }

        const btn = document.createElement('button');
        btn.id = 'gh-copy-diff-btn';
        btn.type = 'button';
        btn.className = 'btn btn-sm';
        btn.textContent = 'Copy Diff';
        btn.style.marginLeft = '8px';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            copyDiff(btn);
        });

        filesTab.insertAdjacentElement('afterend', btn);
        dbg('INSERTED');
    }

    addCopyDiffButton();

    const observer = new MutationObserver(() => {
        addCopyDiffButton();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
