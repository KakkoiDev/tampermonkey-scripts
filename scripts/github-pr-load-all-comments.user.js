// ==UserScript==
// @name         GitHub PR Load All Comments
// @namespace    http://tampermonkey.net/
// @icon         https://github.githubassets.com/favicons/favicon-dark.png
// @version      2026.06.04.1
// @description  Adds "Load all!" button to load all hidden conversations in GitHub PRs
// @author       KakkoiDev
// @match        https://github.com/*
// @grant        none
// @license      MIT
// ==/UserScript==

// Broad @match needed: GitHub uses SPA navigation, so navigating to a PR
// doesn't reload the page. MutationObserver handles detecting "Load more" buttons.

(function() {
    'use strict';

    let isLoadingAll = false;

    function getLoadMoreButtons() {
        return [...document.querySelectorAll('button')].filter(btn =>
            btn.textContent.trim().toLowerCase().includes('load more')
        );
    }

    function clickAllLoadMore() {
        const buttons = getLoadMoreButtons();
        buttons.forEach(btn => btn.click());
        return buttons.length;
    }

    function addLoadAllButtons() {
        const buttons = getLoadMoreButtons();
        buttons.forEach(btn => {
            const parent = btn.parentElement;
            if (!parent || parent.querySelector('.load-all-btn')) return;

            const loadAllBtn = document.createElement('button');
            loadAllBtn.type = 'button';
            loadAllBtn.className = btn.className + ' load-all-btn';
            loadAllBtn.textContent = 'Load all!';

            loadAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                isLoadingAll = true;
                clickAllLoadMore();
            });

            parent.appendChild(loadAllBtn);
        });

        if (isLoadingAll && buttons.length > 0) {
            clickAllLoadMore();
        }
    }

    addLoadAllButtons();

    const observer = new MutationObserver(() => {
        addLoadAllButtons();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();

