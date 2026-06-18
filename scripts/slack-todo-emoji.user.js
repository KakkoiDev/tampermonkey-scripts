// ==UserScript==
// @name         Slack Todo Emoji
// @namespace    http://tampermonkey.net/
// @icon         https://app.slack.com/favicon.ico
// @version      2026.06.18.2
// @description  Todo checkboxes in the Slack composer: type "[] " to add one, click to cycle status, Tab indents, Enter continues the list
// @author       KakkoiDev
// @match        https://app.slack.com/*
// @grant        none
// @license      MIT
// ==/UserScript==

// Slack renders every composer emoji as
//   <img class="emoji" data-id=":code:" data-title=":code:" data-stringify-text=":code:"
//        alt="… emoji" src="<1x1 gif>" style="background-image:url(…/<codepoint>.png)">
// data-id is the stable shortcode; data-stringify-text is what Slack saves. We insert/cycle by
// feeding that <img> through execCommand (the path Slack uses for paste), so Quill re-parses it
// into its own emoji blot from data-id. Quill wraps each emoji embed in U+FEFF cursor anchors, so
// emptiness checks must ignore those. Quill also ignores programmatic multi-node Ranges but honors
// a single-node selectNode (that's why cycling works), so indent/outdent select one node and replace it.
// Lines are plain <p>; indentation is literal leading spaces (lists use a 7-space sub-item indent).

(function () {
    'use strict';

    const EDITOR = '.ql-editor';   // every Slack composer (main, thread, edit) is a Quill .ql-editor
    const EMOJI = 'img.emoji';
    const INDENT = ' '.repeat(7);  // matches the existing 7-space sub-item indent
    const IGNORE = /[ \u00a0\uFEFF]/g;        // spaces, nbsp, and Quill's U+FEFF embed anchors
    const LEAD = /^[ \u00a0\uFEFF]*/;         // leading run of the above
    const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // every emoji's src

    // Status loop (IDEAS #3): ⬜ -> ▶️ -> ✅ -> ⏸️ -> ❌ -> ⬜
    const CYCLE = [
        { code: ':white_square:', cp: '2b1c', alt: 'white square emoji' },
        { code: ':arrow_forward:', cp: '25b6-fe0f', alt: 'arrow forward emoji' },
        { code: ':white_check_mark:', cp: '2705', alt: 'white check mark emoji' },
        { code: ':double_vertical_bar:', cp: '23f8-fe0f', alt: 'double vertical bar emoji' },
        { code: ':x:', cp: '274c', alt: 'cross mark emoji' },
    ];
    const BOX = CYCLE[0];                                  // the checkbox we insert
    const STAR = { code: ':sparkles:', cp: '2728', alt: 'sparkles emoji' }; // importance flag, orthogonal to status
    const byCode = new Map(CYCLE.map((e) => [e.code, e]));

    const EXIT_ON_EMPTY = false; // when true, Enter on an empty checkbox ends the list instead of adding another
    let muting = false;         // ignore our own edits in the line observer

    // handleNewLine continues the list only for a real user newline. Slack rebuilds the editor's <p>s
    // on its own - populating the edit composer when you open a message, re-rendering on save - with no
    // keypress; those must not auto-insert a checkbox (it was filling blank lines with a box on
    // edit/save). Record the last bare Enter (Cmd/Ctrl+Enter is save/send, not a newline; Shift+Enter
    // is a newline, so it's allowed) and let handleNewLine act only within a short grace window after one.
    const NEWLINE_GRACE_MS = 250;
    let lastNewlineKey = 0;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && e.target.closest && e.target.closest(EDITOR)) {
            lastNewlineKey = performance.now();
        }
    }, true);

    // The cyclable checkboxes look clickable (pointer cursor).
    const style = document.createElement('style');
    style.textContent = CYCLE.concat(STAR).map((e) => `${EDITOR} ${EMOJI}[data-id="${e.code}"]`).join(',') + ' { cursor: pointer; }';
    (document.head || document.documentElement).appendChild(style);

    // The glyph is a CSS background-image PNG named by codepoint. We read the live (versioned) asset
    // path off a real emoji so we don't hardcode Slack's "16.0/apple-large", then swap in our codepoint.
    // Slack serves "…/<cp>.png" (NOT "<cp>@2x.png" - that older guess made the swap a no-op, so a cycled
    // box kept the borrowed emoji's glyph while data-id was correct: right on save, wrong on screen). The
    // codepoint token can carry a "-fe0f" variation selector and Slack may or may not append a "@2x"
    // density, so match the hex run before an optional @<n>x and ".png".
    function bgFor(entry) {
        const same = document.querySelector(`${EMOJI}[data-id="${entry.code}"]`);
        if (same) return same.style.backgroundImage;
        const any = document.querySelector(EMOJI);
        if (any) return any.style.backgroundImage.replace(/[0-9a-f]+(?:-[0-9a-f]+)*(?=(?:@\dx)?\.png)/i, entry.cp);
        return `url("https://a.slack-edge.com/production-standard-emoji-assets/16.0/apple-large/${entry.cp}.png")`;
    }

    function emojiHTML(entry) {
        const img = document.createElement('img');
        img.className = 'emoji';
        img.src = GIF;
        img.alt = entry.alt;
        img.setAttribute('data-id', entry.code);
        img.setAttribute('data-title', entry.code);
        img.setAttribute('data-stringify-text', entry.code);
        img.style.backgroundImage = bgFor(entry);
        return img.outerHTML;
    }

    function selectNode(node) {
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNode(node);
        sel.removeAllRanges();
        sel.addRange(r);
    }

    // The first emoji of a line, ignoring leading whitespace-only text. null if the line doesn't start with one.
    function firstEmoji(p) {
        for (const n of p.childNodes) {
            if (n.nodeType === Node.TEXT_NODE && n.textContent.replace(IGNORE, '') === '') continue;
            return n.nodeType === Node.ELEMENT_NODE && n.matches(EMOJI) ? n : null;
        }
        return null;
    }

    // The line's status emoji: the first CYCLE emoji, tolerating a leading :sparkles: (old format).
    function statusEmoji(p) {
        for (const n of p.childNodes) {
            if (n.nodeType === Node.TEXT_NODE && n.textContent.replace(IGNORE, '') === '') continue;
            if (n.nodeType !== Node.ELEMENT_NODE || !n.matches(EMOJI)) return null;
            if (n.getAttribute('data-id') === STAR.code) continue;   // the mark sits before the status - keep scanning
            return byCode.has(n.getAttribute('data-id')) ? n : null;
        }
        return null;
    }

    // Leading real spaces before the first emoji (the indent to replicate), not the U+FEFF anchors.
    function leadingIndent(p) {
        let s = '';
        for (const n of p.childNodes) {
            if (n.nodeType === Node.TEXT_NODE) {
                const ws = n.textContent.match(/^[ \u00a0]*/)[0];
                s += ws;
                if (ws.length < n.textContent.length) break;
            } else break;
        }
        return s;
    }

    function isTodoLine(p) {
        return !!statusEmoji(p);
    }

    // A checkbox line with no text of its own (just indent + the emoji + Quill's anchors).
    function isEmptyTodo(p) {
        return isTodoLine(p)
            && p.querySelectorAll(EMOJI).length === 1
            && (p.textContent || '').replace(IGNORE, '') === '';
    }

    // The line's :sparkles: importance mark (kept right after the status emoji), or null.
    function importantMark(p) {
        return p.querySelector(`${EMOJI}[data-id="${STAR.code}"]`);
    }

    // Toggle the :sparkles: importance mark right after the status box (so every checkbox stays
    // left-aligned), restoring the caret by its distance from the line end - the same edit-then-
    // restore primitive Tab/Shift+Tab uses.
    function toggleImportant(p) {
        const tail = caretTail(p);
        const mark = importantMark(p);
        if (mark) {                                       // remove: single-node select + delete (Quill honors this)
            selectNode(mark);
            document.execCommand('delete');
        } else {                                          // add: replace the status box with [status box][mark]
            const status = statusEmoji(p);
            if (!status) return;
            const entry = byCode.get(status.getAttribute('data-id'));
            selectNode(status);
            document.execCommand('insertHTML', false, emojiHTML(entry) + emojiHTML(STAR));
        }
        setCaretTail(p, tail);
    }

    // The <p> line holding the caret, if it sits inside the given editor.
    function currentLine(editor) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return null;
        const range = sel.getRangeAt(0);
        if (range.startContainer === editor) {
            const child = editor.children[Math.min(range.startOffset, editor.children.length - 1)];
            return child && child.tagName === 'P' ? child : null;
        }
        let node = range.startContainer;
        while (node && node !== editor) {
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'P' && node.parentNode === editor) return node;
            node = node.parentNode;
        }
        return null;
    }

    // Text characters from the caret to the end of the line (invariant when only leading spaces change).
    function caretTail(p) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return 0;
        const c = sel.getRangeAt(0);
        const r = document.createRange();
        r.setStart(c.startContainer, c.startOffset);
        r.setEnd(p, p.childNodes.length);
        return r.toString().length;
    }

    // Put the caret `tail` text-characters from the end of the line (mirror of caretTail).
    function setCaretTail(p, tail) {
        const sel = window.getSelection();
        const texts = [];
        const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        for (let n; (n = walk.nextNode());) texts.push(n);
        const r = document.createRange();
        let rem = tail;
        for (let i = texts.length - 1; i >= 0; i--) {
            if (rem <= texts[i].length) {
                r.setStart(texts[i], texts[i].length - rem);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
                return;
            }
            rem -= texts[i].length;
        }
        r.setStart(p, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
    }

    // --- click an emoji: advance it one step in the loop ---
    document.addEventListener('click', (e) => {
        const img = e.target.closest(EMOJI);
        if (!img || !img.closest(EDITOR)) return;
        const p = img.closest('p');

        // alt+click: toggle the line's importance flag (a trailing :sparkles:), orthogonal to status
        if (e.altKey) {
            if (!p || !isTodoLine(p)) return;   // only meaningful on a checkbox line
            e.preventDefault();
            e.stopPropagation();
            toggleImportant(p);
            return;
        }

        const cur = byCode.get(img.getAttribute('data-id'));
        if (!cur) return;
        e.preventDefault();
        e.stopPropagation();
        const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
        selectNode(img);
        document.execCommand('insertHTML', false, emojiHTML(next)); // replaces the selected emoji
    }, true);

    // Slack builds the emoji's hover tooltip from title / data-title (the :shortcode:); strip them on the
    // clickable boxes so hovering a checkbox doesn't show ":white_square:".
    document.addEventListener('mouseover', (e) => {
        const img = e.target.closest(EMOJI);
        if (!img || !img.closest(EDITOR) || !byCode.has(img.getAttribute('data-id'))) return;
        img.removeAttribute('title');
        img.removeAttribute('data-title');
    }, true);

    // --- type "[] " (or "[ ] ") at the start of a line: turn it into a checkbox ---
    // Mirrors Slack's "- " -> bullet autoformat. The trigger char is the trailing
    // space; the ^ anchor restricts it to the line's leading edge.
    const TODO_PREFIX = /^([ \u00a0]*)\[ ?\] /;
    document.addEventListener('input', (e) => {
        if (muting) return;
        const editor = e.target.closest(EDITOR);
        if (!editor) return;
        const p = currentLine(editor);
        if (!p) return;
        const first = p.firstChild;
        if (!first || first.nodeType !== Node.TEXT_NODE) return;
        const m = first.textContent.match(TODO_PREFIX);
        if (!m) return;

        muting = true;
        try {
            const sel = window.getSelection();
            const r = document.createRange();                 // select just the "[] "/"[ ] " chars, keep the indent
            r.setStart(first, m[1].length);
            r.setEnd(first, m[0].length);
            sel.removeAllRanges();
            sel.addRange(r);
            document.execCommand('insertHTML', false, emojiHTML(BOX) + ' ');
        } finally {
            muting = false;
        }
    }, true);

    // --- Tab / Shift+Tab: indent / outdent by up to 7 spaces. ---
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
        const editor = e.target.closest(EDITOR);
        if (!editor) return;
        if (document.querySelector('[data-qa*="suggestion"], [data-qa*="autocomplete"]')) return;
        e.preventDefault();
        const p = currentLine(editor);
        if (!p) return;
        const tail = caretTail(p); // remember the caret's distance from the line end, then restore it after editing

        if (e.shiftKey) { // outdent: drop up to 7 leading spaces (fewer if that's all there is)
            const first = p.firstChild;
            if (!first || first.nodeType !== Node.TEXT_NODE) return;
            const text = first.textContent;
            const remove = Math.min(INDENT.length, text.match(LEAD)[0].length);
            if (!remove) return;
            const keep = text.slice(remove);
            selectNode(first);                                            // single node: Quill honors this
            if (keep) document.execCommand('insertText', false, keep);    // replace it minus the leading spaces
            else document.execCommand('delete');
            setCaretTail(p, tail);
            return;
        }

        // indent the line's leading edge, regardless of caret position or text after the box
        const first = p.firstChild;
        if (first && first.nodeType === Node.TEXT_NODE) {  // grow the leading text node (proven path; box/text untouched)
            selectNode(first);
            document.execCommand('insertText', false, INDENT + first.textContent);
            setCaretTail(p, tail);
            return;
        }
        if (isTodoLine(p)) {                               // box is the first child: replace it, keep a separator after it
            const bare = isEmptyTodo(p);
            selectNode(firstEmoji(p));
            document.execCommand('insertText', false, INDENT);
            document.execCommand('insertHTML', false, emojiHTML(BOX) + (bare ? ' ' : ''));
            setCaretTail(p, tail);
            return;
        }
        document.execCommand('insertText', false, INDENT); // empty or non-todo line: indent at the caret
    }, true);

    // --- a new line was created: if the line above is a checkbox line, continue the list ---
    function handleNewLine(newP) {
        if (muting) return;
        if (performance.now() - lastNewlineKey > NEWLINE_GRACE_MS) return; // no recent user Enter: this <p> came from Slack rebuilding the editor (edit-open / save), not a newline
        const prev = newP.previousElementSibling;
        if (!prev || prev.tagName !== 'P' || !isTodoLine(prev)) return;
        // only a clean "Enter at end of item" - the new line is still empty
        if ((newP.textContent || '').replace(IGNORE, '') !== '' || newP.querySelector(EMOJI)) return;

        muting = true;
        setTimeout(() => {
            try {
                const sel = window.getSelection();
                if (EXIT_ON_EMPTY && isEmptyTodo(prev)) {
                    const r = document.createRange();   // empty checkbox + Enter -> end the list
                    r.selectNodeContents(prev);
                    sel.removeAllRanges();
                    sel.addRange(r);
                    document.execCommand('delete');
                    return;
                }
                const r = document.createRange();       // continue: indent + a fresh checkbox on the new line
                r.setStart(newP, 0);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
                const indent = leadingIndent(prev);
                if (indent) document.execCommand('insertText', false, indent);
                document.execCommand('insertHTML', false, emojiHTML(BOX) + ' ');
            } finally {
                muting = false;
            }
        }, 0);
    }

    new MutationObserver((muts) => {
        if (muting) return;
        for (const m of muts) {
            if (m.type !== 'childList') continue;
            for (const node of m.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'P'
                    && node.parentElement && node.parentElement.classList.contains('ql-editor')) {
                    handleNewLine(node);
                }
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
})();
