// ==UserScript==
// @name         GitHub PR Copy Diff
// @namespace    http://tampermonkey.net/
// @icon         https://github.githubassets.com/favicons/favicon-dark.png
// @version      2026.06.04.1
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
        if (!filesTab) return;
        if (document.getElementById('gh-copy-diff-btn')) return;

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
