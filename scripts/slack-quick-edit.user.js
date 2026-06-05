// ==UserScript==
// @name         Slack Quick Edit
// @namespace    http://tampermonkey.net/
// @icon         https://app.slack.com/favicon.ico
// @version      2026.06.05
// @description  Double-click your own Slack message to edit it (Cmd/Ctrl+Enter saves, Esc cancels)
// @author       KakkoiDev
// @match        https://app.slack.com/*
// @grant        none
// @license      MIT
// ==/UserScript==

// Selectors confirmed from live Slack DOM (2026-06):
//   message row      [data-qa="message_container"]
//   more-actions  ⋮  [data-qa="more_message_actions"]  (in the hover toolbar)
//   edit textarea    [data-feat="edit_composer"]        (the Quill .ql-editor, only while editing)
// The "Edit message" item in the ⋮ menu has no stable data-qa, so it's matched by
// visible text (English). Ownership = that item only exists on your own messages.
// Saving/cancelling is Slack-native (Cmd/Ctrl+Enter saves, Esc cancels); we just focus
// the edit box after a programmatic open so those keys work immediately.

(function () {
    'use strict';

    const MESSAGE = '[data-qa="message_container"]';
    const MORE = '[data-qa="more_message_actions"]';
    const EDIT_BOX = '[data-feat="edit_composer"]';

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const editMenuItem = () =>
        [...document.querySelectorAll('[role="menuitem"]')]
            .find((el) => /edit message/i.test(el.textContent || ''));

    async function enterEdit(message) {
        message.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); // reveal toolbar
        let more;
        for (let i = 0; i < 12 && !(more = message.querySelector(MORE)); i++) await sleep(25);
        if (!more) return;
        more.click(); // open the ⋮ menu
        let item;
        for (let i = 0; i < 20 && !(item = editMenuItem()); i++) await sleep(25);
        if (!item) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // not ours
            return;
        }
        item.click(); // -> edit mode
        let box;
        for (let i = 0; i < 20 && !(box = document.querySelector(EDIT_BOX)); i++) await sleep(25);
        box?.focus(); // so native Cmd/Ctrl+Enter (save) and Esc (cancel) work right away
    }

    document.addEventListener('dblclick', (e) => {
        if (e.target.closest(EDIT_BOX)) return; // double-clicking inside an edit box: leave it alone
        const message = e.target.closest(MESSAGE);
        if (!message || message.querySelector(EDIT_BOX)) return; // none, or already editing this one
        window.getSelection()?.removeAllRanges(); // drop the word dblclick selected
        enterEdit(message);
    });
})();
