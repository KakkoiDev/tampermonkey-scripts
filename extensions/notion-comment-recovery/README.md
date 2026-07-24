# Notion Comment Recovery (Chrome extension)

The `scripts/notion-comment-recovery.user.js` userscript, packaged as a Chrome extension so colleagues can install it in one click without Tampermonkey.

This is the **first proof** of the "userscript -> extension" pipeline. The userscript stays the single source of truth; `notion-comment-recovery.js` here is **generated** from it by `tools/build-extensions.mjs` (wired into the pre-commit hook), pointed by `source.json`. The generator also syncs this extension's `manifest.json` version to the userscript's `@version`. Never edit the generated `.js` by hand - edit `scripts/notion-comment-recovery.user.js`.

## Why it's shaped this way

- **`world: "MAIN"`** - the script hooks the page's own `fetch`/`XMLHttpRequest` to passively capture Notion's API responses. That only works in the page's realm, not a content script's isolated world.
- **`run_at: "document_start"`** - the hook must be installed before Notion makes its first API calls. (See the timing caveat below.)
- **No permissions / host_permissions** - it's `@grant none`; all its API calls are same-origin page `fetch`es, so the extension declares nothing beyond the content-script `matches`.
- **`minimum_chrome_version: 111`** - `world: "MAIN"` in a static content script needs Chrome 111+.

## Install (unpacked, for testing)

1. `chrome://extensions` -> **Developer mode** on -> **Load unpacked** -> select this folder.
2. Open a Notion page. A floating "N comments" badge appears top-right; click it for the panel.

**Disable the Tampermonkey version first.** Both inject into the MAIN world; the script's `window.__NOC_ARMED__` guard means only the first to run wins, so to know you're testing the *extension*, turn off the userscript.

## Known caveat to verify

`world: "MAIN"` + `document_start` injection ordering vs the page's own scripts isn't guaranteed as tightly as Tampermonkey's. If the passive capture (catching comments/deletions as you browse) seems to miss things, that's the hook losing the race - the active scan (existing comments, deep history scan, export, restore) still works because it makes its own fetches.

## Distribution

Unpacked is dev-only. For colleagues, this needs to go on the Chrome Web Store (dev account + review) or be pushed by IT. Not covered here yet.
