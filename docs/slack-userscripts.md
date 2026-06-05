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

## Confirm dialogs are shared
- Destructive actions open a dialog whose buttons are **generic**: confirm = `button[data-qa="dialog_go"]`, cancel = `dialog_cancel`, close = `dialog_close`. Identical across *every* dialog (delete message, leave channel, ...).
- **Never click `dialog_go` unscoped.** Scope by the dialog's `aria-label`: `[data-qa="dialog"][aria-label="Remove preview?"] button[data-qa="dialog_go"]`. Otherwise you auto-confirm whatever dialog happens to be open.

## Sequential actions (one dialog at a time)
Slack shows a single confirm dialog at a time. Batch operations must be sequential: click one trigger -> wait for its dialog -> confirm -> next. Firing all triggers at once opens one dialog and silently drops the rest (this is exactly the bug that made auto-remove-preview clear only the first item). A small observer-driven state machine with `setTimeout` between steps handles it - see the auto-remove-preview source.

## Author-only controls
Some controls (e.g. the remove-preview "x") render only for the message author, so you can act on any you find without an ownership check.

## Confirmed selectors
| Thing | Selector |
|---|---|
| Remove "x" on a v1 link unfurl | `button[data-qa="message_attachment_v1_delete_button"]` |
| Remove "x" on a v2 work-object unfurl (Google Docs/Drive/Figma) | `[data-qa="message_attachment_v2_delete"] button` |
| "Remove preview?" confirm | `[data-qa="dialog"][aria-label="Remove preview?"] button[data-qa="dialog_go"]` |
| Message composer input | `.ql-editor` (Quill) |

Slack ships UI changes often - if a selector stops matching, re-run the discovery probe.
