// ==UserScript==
// @name         Gmeet Standup Roster
// @namespace    http://tampermonkey.net/
// @icon         https://meet.google.com/favicon.ico
// @version      2026.06.25.1
// @description  Marks who has talked directly in Google Meet's People panel - auto-detected from the grid even before the panel is opened, manually toggleable
// @author       KakkoiDev
// @match        https://meet.google.com/*
// @grant        none
// @license      MIT
// ==/UserScript==

/**
 * Gmeet Standup Roster
 *
 * Enhances Google Meet's native People panel (no separate UI): each participant gets a
 * presence-style "talked" badge on their avatar that auto-sets the first time they
 * speak (Meet itself already shows who is speaking right now). The badge is manually
 * toggleable - untick someone who only answered a question, or tick someone the detector
 * missed. State is per-session: it clears on page reload and when the meeting changes.
 *
 * Speaking is detected from each participant's audio equalizer ([jsname="QgSmzd"]),
 * whose class churns rapidly while they produce audio and is static when silent.
 * Detection runs off every equalizer found in the VIDEO GRID tiles (which carry
 * data-participant-id and exist even while the People panel is closed) AND the panel
 * rows. Each equalizer element is compared against its OWN previous class (a WeakMap),
 * and a participant counts as speaking only after >=2 class changes within the window -
 * so duplicate tiles, tile reordering, and one-off layout blips don't false-trigger.
 *
 * Limitation: large meetings virtualize/paginate both the grid and the panel, so a
 * participant with no rendered tile (and panel closed) won't be tracked until visible.
 *
 * All Meet DOM hooks are isolated in SEL for quick repair when Google changes the DOM.
 */

(function () {
    'use strict';

    const DEBUG = false;

    // Meet DOM hooks. Anchored on data-panel-id / role / jsname / data-participant-id
    // (stable), never hashed presentational classes.
    const SEL = {
        panel: 'div[data-panel-id="1"]', // People panel container
        list: '[role="list"]', // participants list inside the panel
        item: '[role="listitem"]', // one participant row in the panel
        gridTile: '[data-participant-id]:not([role="listitem"])', // a video-grid tile
        eq: '[jsname="QgSmzd"]', // audio equalizer; class churns while speaking (jsname, no stable alt)
    };
    // The badge is anchored to the avatar <img> (a stable tag, not a hashed class).

    const TICK_MS = 200; // poll cadence
    const SPEAK_WINDOW_MS = 1000; // window for counting recent equalizer changes
    const SPEAK_MIN_CHANGES = 2; // changes within the window required to count as speaking

    // per participant-id state: { stamps:[ts], speaking, talked }
    const people = new Map();
    // per equalizer ELEMENT -> its last-seen className. WeakMap so detached nodes are GC'd
    // and each physical element is compared only against its own history.
    const eqLast = new WeakMap();
    let lastPath = location.pathname;

    function getPerson(pid) {
        let p = people.get(pid);
        if (!p) {
            p = { stamps: [], speaking: false, talked: false };
            people.set(pid, p);
        }
        return p;
    }

    // Record an equalizer-class change for a participant if this specific element changed.
    function scanEq(container, now) {
        const pid = container.getAttribute('data-participant-id');
        if (!pid) return;
        const eq = container.querySelector(SEL.eq);
        if (!eq) return;
        const cls = eq.className;
        const prev = eqLast.get(eq);
        eqLast.set(eq, cls);
        if (prev !== undefined && prev !== cls) getPerson(pid).stamps.push(now);
    }

    // Add a presence-style "talked" badge to the corner of the avatar, once. Positioned
    // against the avatar so it never fights Meet's row/control flex layout.
    function injectRow(li, p) {
        if (li.querySelector('.gsr-badge')) return;
        const img = li.querySelector('img'); // avatar image - stable tag anchor
        const avatar = img && img.parentElement;
        if (!avatar) return;
        if (getComputedStyle(avatar).position === 'static') avatar.style.position = 'relative';
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'gsr-badge';
        badge.title = 'Talked (click to toggle)';
        badge.style.cssText = [
            'position:absolute',
            'right:-2px',
            'bottom:-2px',
            'box-sizing:border-box',
            'width:16px',
            'height:16px',
            'padding:0',
            'margin:0',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'border-radius:50%',
            'border:2px solid #1f1f1f', // cutout against the panel bg
            'font:700 9px/1 system-ui,sans-serif',
            'cursor:pointer',
        ].join(';');
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            p.talked = !p.talked;
            paintRow(li, p);
        });
        avatar.appendChild(badge);
    }

    // Refresh a panel row's visuals from state.
    function paintRow(li, p) {
        const badge = li.querySelector('.gsr-badge');
        if (badge) {
            if (p.talked) {
                badge.style.background = '#34a853';
                badge.style.color = '#fff';
                badge.style.opacity = '1';
                badge.textContent = '✓';
            } else {
                badge.style.background = '#5f6368';
                badge.style.color = 'transparent';
                badge.style.opacity = '0.55';
                badge.textContent = '';
            }
        }
    }

    function tick() {
        const now = Date.now();

        // New meeting -> fresh round.
        if (location.pathname !== lastPath) {
            lastPath = location.pathname;
            people.clear();
        }

        // Detection: every grid tile (present even while the People panel is closed).
        document.querySelectorAll(SEL.gridTile).forEach((tile) => scanEq(tile, now));

        // When the panel is open: also scan its rows, and render the badges.
        const panel = document.querySelector(SEL.panel);
        const list = panel && panel.querySelector(SEL.list);
        if (list) {
            list.querySelectorAll(SEL.item).forEach((li) => {
                const pid = li.getAttribute('data-participant-id');
                if (!pid) return;
                const p = getPerson(pid);
                scanEq(li, now);
                injectRow(li, p);
            });
        }

        // Finalize speaking/talked: speaking needs >=N equalizer changes in the window.
        people.forEach((p, pid) => {
            p.stamps = p.stamps.filter((t) => now - t < SPEAK_WINDOW_MS);
            p.speaking = p.stamps.length >= SPEAK_MIN_CHANGES;
            if (p.speaking) p.talked = true;
            if (DEBUG && p.speaking) console.log('[standup] speaking:', pid.slice(-6), p.stamps.length);
        });

        // Paint panel rows from the now-final state.
        if (list) {
            list.querySelectorAll(SEL.item).forEach((li) => {
                const pid = li.getAttribute('data-participant-id');
                const p = pid && people.get(pid);
                if (p) paintRow(li, p);
            });
        }
    }

    setInterval(tick, TICK_MS);
})();
