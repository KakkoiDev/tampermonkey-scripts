// ==UserScript==
// @name         Refined GitHub Preview Debanner
// @namespace    http://tampermonkey.net/
// @icon         https://refined-github-html-preview.kidonng.workers.dev/icon.png
// @version      2026.07.10.1
// @description  Remove the Refined GitHub HTML Preview warning banner on page load
// @author       KakkoiDev
// @match        https://refined-github-html-preview.kidonng.workers.dev/*
// @exclude      https://refined-github-html-preview.kidonng.workers.dev/_render/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

// The Refined GitHub HTML Preview worker renders a chrome banner (icon + title + a
// "Do not enter passwords" warning) as `main > header` on every preview page. This
// deletes it on load with no flash.
//
// Anti-flash + delete: a document-start <style> hides the banner the instant it parses
// (so it never paints), then the node is removed once the DOM is ready.
//
// Two guards keep this off the previewed content: @exclude keeps the script out of the
// preview iframe (src=/_render/...), and `main > header` never matches a Marp slide's own
// header (those are `section > header`).

(function () {
    'use strict';

    const SEL = 'main > header'; // the RGH preview chrome; the deck iframe is @exclude-d

    const style = document.createElement('style');
    style.textContent = `${SEL} { display: none !important; }`;
    (document.head || document.documentElement).appendChild(style);

    const remove = () => document.querySelector(SEL)?.remove();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', remove, { once: true });
    } else {
        remove();
    }
})();
