// ==UserScript==
// @name         GitHub PR Copy Title + Link
// @namespace    http://tampermonkey.net/
// @icon         https://github.githubassets.com/favicons/favicon-dark.png
// @version      2026.06.15.4
// @description  Adds a button by the PR title that copies the title + link as a rich link (Slack/Notion) and markdown (MD files)
// @author       KakkoiDev
// @match        https://github.com/*
// @grant        none
// @license      MIT
// ==/UserScript==

// Broad @match needed: GitHub uses SPA navigation, so the MutationObserver
// re-adds the button as the PR header re-renders.
//
// navigator.clipboard.write (not GM_setClipboard): we write BOTH text/html
// (<a href>) and text/plain (the URL) in one ClipboardItem. Slack and Notion
// read the HTML and render a named link showing the title; plain-text targets
// (markdown files, code editors, anything with no rich paste) get the URL - a
// working link, not an unlinked title. Mirrors Notion's native "Copy link".
// GM_setClipboard writes a single plain flavor only. No fetch -> no GM grants.

(function() {
    'use strict';

    const COPY_SVG = '<svg data-component="Octicon" aria-hidden="true" focusable="false" class="octicon octicon-copy" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>';
    const CHECK_SVG = '<svg data-component="Octicon" aria-hidden="true" focusable="false" class="octicon octicon-check" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';

    const BTN_ID = 'gh-copy-title-link-btn';
    const TITLE_TEXT = 'Copy title with link';

    function getPrInfo() {
        const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (!m) return null;
        return { owner: m[1], repo: m[2], number: m[3] };
    }

    function esc(s) {
        return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function flash(btn) {
        btn.innerHTML = CHECK_SVG;
        btn.title = 'Copied!';
        btn.setAttribute('aria-label', 'Copied!');
        setTimeout(() => {
            btn.innerHTML = COPY_SVG;
            btn.title = TITLE_TEXT;
            btn.setAttribute('aria-label', TITLE_TEXT);
        }, 1200);
    }

    async function copyTitleLink(btn) {
        const pr = getPrInfo();
        if (!pr) return;
        const titleSpan = document.querySelector('h1[data-component="PH_Title"] span.markdown-title');
        if (!titleSpan) return;

        const title = titleSpan.textContent.trim();
        const url = `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;
        const label = `${title} #${pr.number}`;
        const html = `<a href="${esc(url)}">${esc(label)}</a>`;

        // text/plain is the URL, not the title: plain-text / dumb editors then
        // paste a working link instead of unlinked title text. Slack / Notion
        // ignore plain and render the html anchor (title as link text). Putting
        // markdown here instead would make paste-as-link editors double-wrap it
        // -> [[label](url)](url), so keep plain a bare URL.
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([url], { type: 'text/plain' }),
                }),
            ]);
            flash(btn);
        } catch (e) {
            // Older browsers / no ClipboardItem: URL only.
            try {
                await navigator.clipboard.writeText(url);
                flash(btn);
            } catch (e2) {
                btn.title = 'Copy failed';
                setTimeout(() => { btn.title = TITLE_TEXT; }, 1200);
            }
        }
    }

    function addCopyButton() {
        const pr = getPrInfo();
        if (!pr) return;
        if (document.getElementById(BTN_ID)) return;

        const editBtn = document.querySelector('h1[data-component="PH_Title"] button[data-component="IconButton"]');
        if (!editBtn) return;

        const btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.type = 'button';
        btn.className = editBtn.className;
        btn.title = TITLE_TEXT;
        btn.setAttribute('aria-label', TITLE_TEXT);
        btn.innerHTML = COPY_SVG;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            copyTitleLink(btn);
        });

        editBtn.insertAdjacentElement('afterend', btn);
    }

    addCopyButton();

    const observer = new MutationObserver(() => {
        addCopyButton();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
