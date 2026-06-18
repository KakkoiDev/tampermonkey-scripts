# Writing userscripts for Slack

Notes for building Tampermonkey userscripts against Slack's web app (`app.slack.com`), learned while building [`slack-auto-remove-preview.user.js`](../scripts/slack-auto-remove-preview.user.js). Iterate with the [live-reload loop](DEVELOPMENT.md).

## Slack is a React SPA
- Navigation never reloads the page. Match `https://app.slack.com/*` and drive everything from a `MutationObserver` on `document.body` with `{ childList: true, subtree: true }`.
- The DOM re-renders constantly, so the observer fires many times per logical change. Guard so one logical change causes one action (see *Sequential actions*).

## Picking selectors
- **Prefer `data-qa`** - stable across builds and locale-independent.
- **Never select by CSS class** - they're hashed per build (`container__pOUfp`, `c-message_attachment_v2__delete`) and change without notice.
- **`aria-label` is localized** - fine in English, breaks in other languages. Use only as a last resort, or to scope when `data-qa` is generic.
- Some controls share a **generic `data-qa="unstyled-button"`** - reach them via a parent that has a specific `data-qa` (e.g. `[data-qa="message_attachment_v2_delete"] button`).

## Discovering selectors
Drop a temporary console probe, run it in DevTools with the target UI on screen (hover to reveal hover-only controls), then delete it:
```js
window.probe = () =>
  [...document.querySelectorAll('button[aria-label], button[data-qa]')]
    .map((b) => ({ aria: b.getAttribute('aria-label'), qa: b.getAttribute('data-qa') }))
    .filter((x) => /KEYWORD/i.test(`${x.aria} ${x.qa}`));
```
Gotchas when probing:
- **Run it in the page, not a userscript sandbox.** The DevTools console context dropdown (top-left of the Console) must be `top`; if it's set to an installed userscript you'll get `probe is not defined`.
- **Copy clean output** with `copy(JSON.stringify(probe('edit'), null, 2))` - it puts JSON on your clipboard. Copying straight from the console scrollback comes out garbled.
- **One element's markup**: right-click it -> Inspect -> Copy -> **Copy element** (not a big ancestor).

## Confirm dialogs are shared
- Destructive actions open a dialog whose buttons are **generic**: confirm = `button[data-qa="dialog_go"]`, cancel = `dialog_cancel`, close = `dialog_close`. Identical across *every* dialog (delete message, leave channel, ...).
- **Never click `dialog_go` unscoped.** Scope by the dialog's `aria-label`: `[data-qa="dialog"][aria-label="Remove preview?"] button[data-qa="dialog_go"]`. Otherwise you auto-confirm whatever dialog happens to be open.

## Sequential actions (one dialog at a time)
Slack shows a single confirm dialog at a time. Batch operations must be sequential: click one trigger -> wait for its dialog -> confirm -> next. Firing all triggers at once opens one dialog and silently drops the rest (this is exactly the bug that made auto-remove-preview clear only the first item). A small observer-driven state machine with `setTimeout` between steps handles it - see the auto-remove-preview source.

## Author-only controls
Some controls (e.g. the remove-preview "x") render only for the message author, so you can act on any you find without an ownership check.

## Editing a message
There's no API - drive Slack's own UI (see `scripts/slack-quick-edit.user.js`):
1. Hover the message (dispatch `mouseover` on `[data-qa="message_container"]`) to render its toolbar, then click the ⋮ `[data-qa="more_message_actions"]`.
2. In the popup, click the **Edit message** item. It has no stable `data-qa`, so match `[role="menuitem"]` by text (English). Its presence doubles as the ownership test - only your own messages have it, so if it's absent, the message isn't yours: bail.
3. After a *programmatic* open, **focus the edit box** (`[data-feat="edit_composer"]`) or Slack's native keys won't fire. Then **Cmd/Ctrl+Enter saves, Esc cancels** - simpler and more robust than clicking the (data-qa-less) Save button.

## Editing inside the composer (Todo Emoji)

Built `scripts/slack-todo-emoji.user.js` against the Quill composer (`.ql-editor` - the same element for the main box, the thread box, and the edit box). DOM shape:
- **Emoji are `<img class="emoji">`, not Unicode text.** `data-id` / `data-title` / `data-stringify-text` all hold the shortcode (`:white_check_mark:`); `data-stringify-text` is what Slack saves; the glyph is a CSS `background-image` (`…/16.0/apple-large/<codepoint>.png` - **no `@2x`**, e.g. `2b1c.png`, multi-codepoint as `1f1ef-1f1f5.png`) and `src` is a shared 1x1 transparent gif. `class="emoji"` is stable - anchor on it, read the shortcode from `data-id`.
- **To synthesize a different emoji, swap the codepoint in a borrowed emoji's `background-image`.** Read a live emoji's URL (don't hardcode the versioned `16.0/apple-large` path) and replace its codepoint token with yours: `bg.replace(/[0-9a-f]+(?:-[0-9a-f]+)*(?=(?:@\dx)?\.png)/i, cp)`. The token can carry a `-fe0f` variation selector, so match the hyphen-joined hex run before the optional `@<n>x` and `.png` - **not** a fixed `@2x` suffix. A stale `…@2x\.png` matcher was a silent no-op against the current `<cp>.png` URLs, so a cycled todo box kept the borrowed glyph while `data-id` (hence the save) was correct: right on save, wrong on screen. Found by logging the live node's computed `background-image` (the slack-todo-emoji repaint bug).
- **Lines are plain `<p>`; indentation is literal leading spaces** (`white-space: pre-wrap` keeps them). No list markup.

Quill mechanics that cost real debugging time - it owns the DOM, so you fight its model, not the DOM:
- **Embeds are wrapped in `U+FEFF` cursor anchors.** An emoji's `<p>` has zero-width `\uFEFF` chars around the `<img>`, so `textContent` is never `''` even for a box-only line. Strip `\uFEFF` (not just space / `\u00a0`) in every "is this line empty?" check, or detection silently fails. This one was invisible until a logged `textContent` showed `"\uFEFF\uFEFF"`.
- **Quill honors a single-node `selectNode`, but ignores programmatic multi-node `Range`s.** `selectNode(oneNode)` + `execCommand('insertText'|'insertHTML')` reliably *replaces that node* (this is why click-to-cycle works). `selectNodeContents(p)` or a hand-built sub-range is ignored - Quill edits at its own caret instead. So the reliable edit primitive is **select exactly one node and replace it**.
- **You can't place the caret before a leading inline embed.** Collapse a range before the first `<img>` and Quill normalizes it to *after* the embed, so a caret-insert lands after the box. To put spaces before a leading box, *replace the box node* (`selectNode(img)` -> insertText spaces -> insertHTML the box back) or grow an existing leading text node; never caret-insert there.
- **`insertHTML` trims leading whitespace; `insertText` preserves it.** Use `insertText` for indentation spaces; use `insertHTML` for the emoji `<img>` - Quill re-parses it into its blot from `data-id`, rebuilding the visual, so you don't hardcode the asset URL (read the versioned base off an existing `.emoji` only for the rare keep-raw-node case). Same DOM-write path `slack-ai-translate` relies on.
- **Importance flag sits right after the status box.** `alt+click` a checkbox toggles a `:sparkles:` immediately after the status emoji (orthogonal to the status cycle - a task can be important AND done), so every checkbox stays left-aligned and only the important line's text shifts right. It's added by *replacing the status node* with `[status][:sparkles:]` (one-node select - the proven primitive) and removed by selecting the mark and deleting; the caret is restored by its distance from the line end, exactly like Tab indent. `statusEmoji()` still tolerates a leading `:sparkles:` (old format) so `isTodoLine`, Enter-continue, and indent always find the real status. Routines (`weekly-wins`, `todo-triage`) read `:sparkles:` anywhere on the line as "important".
- **Preserve the caret by its distance from the line end.** When an edit only changes *leading* content (indent), the text from the caret to the end of the line is invariant: record that length before, walk back that many chars from the end after. Survives Quill re-rendering the line (saved node references don't).
- **React to a newline without binding a key.** A `MutationObserver` catching a new `<p>` fires however the line was made - Enter, Shift+Enter, or whatever the "Enter sends" setting is. If Enter *sends*, no `<p>` appears, so nothing fires and the message just sends. Settings-agnostic.

All of the above was found by **instrumenting, not guessing** - temporary `console.log` of the line's `outerHTML` and which branch ran, pasted back from logged-in Slack ([Debugging on a logged-in site](DEVELOPMENT.md#debugging-on-a-logged-in-site)).

## Confirmed selectors
| Thing | Selector |
|---|---|
| Remove "x" on a v1 link unfurl | `button[data-qa="message_attachment_v1_delete_button"]` |
| Remove "x" on a v2 work-object unfurl (Google Docs/Drive/Figma) | `[data-qa="message_attachment_v2_delete"] button` |
| "Remove preview?" confirm | `[data-qa="dialog"][aria-label="Remove preview?"] button[data-qa="dialog_go"]` |
| Message composer input | `.ql-editor` (Quill) |
| One message (row) | `[data-qa="message_container"]` |
| Message hover ⋮ more-actions | `[data-qa="more_message_actions"]` |
| "Edit message" menu item | no stable `data-qa` - match `[role="menuitem"]` by text "Edit message" (English) |
| Active edit box (while editing) | container `[data-qa="message_editor"]`; textarea `[data-feat="edit_composer"]` |
| Edit Save / Cancel | inside the editor, no `data-qa`: Save = `button.c-button--primary`, Cancel = `button.c-button--outline` (or save natively with Cmd/Ctrl+Enter) |
| Composer emoji | `img.emoji` - shortcode in `data-id` / `data-stringify-text`; glyph is a CSS `background-image` (`…/<codepoint>.png`, no `@2x`), `src` is a 1x1 gif |
| Composer line / indent | each line is a `<p>`; indentation is literal leading spaces (no list markup) |

Slack ships UI changes often - if a selector stops matching, re-run the discovery probe.
