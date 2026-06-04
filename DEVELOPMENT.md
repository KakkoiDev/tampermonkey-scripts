# Local development (live reload)

Edit a userscript file on disk, reload the page, see the change - no copy-paste into Tampermonkey, no Greasy Fork round-trip. Confirmed working on Tampermonkey 5.5.6237 (Chrome).

## Requirements
- **Chrome** (or a Chromium browser). Loading userscripts from `file://` does **not** work in Firefox.
- **Tampermonkey 5.5.0+** (it tracks local file changes on disk).
- **Grant file access**: `chrome://extensions` -> Tampermonkey -> *Details* -> turn on **"Allow access to file URLs"**, and set **Site access -> "On all sites"**.

## One-time setup per script
Create a small **dev loader** userscript in Tampermonkey that pulls the real file from disk:

```javascript
// ==UserScript==
// @name         DEV: <Script Name> (local)
// @namespace    http://tampermonkey.net/
// @version      0.0.1
// @match        <copy the real script's @match>
// @grant        <copy the real script's @grant>
// @require      file:///absolute/path/to/<script>.user.js
// ==/UserScript==
```

Two things that bite people:
- **The `@require`d file's own `// ==UserScript==` header is ignored** - it runs as a plain library. So `@match`, `@grant`, and `@run-at` must be set on the **loader**, not the target file.
- **Disable any installed/published copy** of the same script (e.g. the one synced from Greasy Fork) so it doesn't run twice alongside the loader.

## The loop
1. Edit the real `.user.js` file (you or an AI/editor).
2. Reload the page.
3. The change is live. You do **not** re-save the loader.

Tip: add `console.log('[my-script] vN loaded')` and bump `N` to confirm reloads are picking up your edits. Keep destructive actions behind a `DRY_RUN` flag while iterating.

## Troubleshooting
- **"Not allowed to load local resource" / nothing loads** - file access isn't granted (see Requirements), or Site access isn't "On all sites".
- **Edits don't show on reload** - the `@require` is being cached. Set Tampermonkey -> *Settings* -> **Externals -> Update Interval** to anything other than "Never", or re-save the loader once to force a refetch. (On 5.5.6237 it was live even with "Never".)
- **Firefox** - not supported; use Chrome.

## Relationship to production
The loader is **dev-only** and lives only in your Tampermonkey - it is not part of this repo. The real `.user.js` file is what gets published: it syncs to Greasy Fork via the [`greasyfork` skill](skills/greasyfork/) (see the README). Same source file, two consumption paths - local loader for development, Greasy Fork raw URL for release.

## Site-specific notes
- **Slack** (`app.slack.com`) - selectors, shared confirm-dialog scoping, SPA patterns, and the discovery probe, learned building scripts: [docs/slack-userscripts.md](docs/slack-userscripts.md).
