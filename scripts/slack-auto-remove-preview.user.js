// ==UserScript==
// @name         Slack Auto-remove Preview
// @namespace    http://tampermonkey.net/
// @version      2026.06.05
// @description  Auto-remove link previews (unfurls) on your own Slack messages
// @author       KakkoiDev
// @match        https://app.slack.com/*
// @icon         https://app.slack.com/favicon.ico
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // Two attachment variants: v1 (link unfurls) and v2 (work objects, e.g. Google Docs).
    // v2's button has a generic data-qa, so target it via its delete container.
    const REMOVE = 'button[data-qa="message_attachment_v1_delete_button"], [data-qa="message_attachment_v2_delete"] button';
    // Auto-confirm ONLY the "Remove preview?" dialog - scoped by the dialog's aria-label
    // so we never confirm any other Slack dialog reusing the generic data-qa="dialog_go".
    const CONFIRM = '[data-qa="dialog"][aria-label="Remove preview?"] button[data-qa="dialog_go"]';

    // Slack opens one confirm dialog at a time, so process previews sequentially:
    // click one "x" -> wait for its dialog -> confirm -> repeat.
    let running = false;
    let awaitingDialog = 0;

    function step() {
        const confirm = document.querySelector(CONFIRM);
        if (confirm) {
            confirm.click();
            awaitingDialog = 0;
            return setTimeout(step, 400);
        }
        if (awaitingDialog) {
            if (awaitingDialog++ < 10) return setTimeout(step, 150);
            awaitingDialog = 0;
        }
        const btn = document.querySelector(REMOVE);
        if (btn) {
            btn.click();
            awaitingDialog = 1;
            return setTimeout(step, 150);
        }
        running = false; // nothing left; idle until the next DOM change
    }

    function pump() {
        if (running) return;
        running = true;
        awaitingDialog = 0;
        step();
    }

    new MutationObserver(pump).observe(document.body, { childList: true, subtree: true });
    pump();
})();
