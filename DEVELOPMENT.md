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
// @description  dev loader
// @match        <copy from the real script>
// @grant        <copy EVERY @grant from the real script, incl. GM_* ones>
// @connect      <copy every @connect, if it uses GM_xmlhttpRequest>
// @run-at       <copy if the real script sets it>
// @require      file:///absolute/path/to/scripts/<script>.user.js
// ==/UserScript==
```

`@name`, `@namespace`, `@version`, and `@description` are all required by the userscript linter (`eslint-plugin-userscripts`, which Tampermonkey's editor runs) - `@description` is the one people forget; any text works. Everything else above is needed at runtime.

Two things that bite people:
- **The `@require`d file's own `// ==UserScript==` header is IGNORED** - Tampermonkey runs it as a plain library and reads metadata only from the **loader**. Copy *every* runtime key onto the loader: `@match`, **every** `@grant` (including `GM_*` like `GM_xmlhttpRequest` / `GM_setClipboard`), **`@connect`** (every domain a `GM_xmlhttpRequest` reaches, *including redirect targets*), `@run-at`, and any `@require`/`@resource` the script uses. Miss a `@grant` and that `GM_*` function is `undefined`; miss a `@connect` and the request is blocked.
- **Disable any installed/published copy** of the same script (e.g. the one synced from Greasy Fork) so it doesn't run twice alongside the loader.

### Scripts that call `GM_*` APIs (e.g. `GM_xmlhttpRequest`)
A plain `@grant none` loader is enough for most scripts, but ones using GM APIs need their grants AND connect domains on the **loader**, plus a one-time browser permission:
- On the first cross-origin `GM_xmlhttpRequest`, Tampermonkey prompts *"userscript wants to connect to `<domain>`"* - click **Always allow**. `@connect` must list every domain reached, **including redirect targets** (a `github.com/.../pull/N.diff` request 302s to `githubusercontent.com`, so both are required).

Example loader for `scripts/github-pr-copy-diff.user.js`:
```javascript
// ==UserScript==
// @name         DEV: GitHub PR Copy Diff (local)
// @namespace    http://tampermonkey.net/
// @version      0.0.1
// @description  dev loader
// @match        https://github.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      github.com
// @connect      githubusercontent.com
// @require      file:///Users/cyril.antoni/Code/tampermonkey-scripts/scripts/github-pr-copy-diff.user.js
// ==/UserScript==
```

## The loop
1. Edit the real `.user.js` file (you or an AI/editor).
2. Reload the page.
3. The change is live. You do **not** re-save the loader.

Tip: add `console.log('[my-script] vN loaded')` and bump `N` to confirm reloads are picking up your edits. Keep destructive actions behind a `DRY_RUN` flag while iterating.

## Troubleshooting
- **"Not allowed to load local resource" / nothing loads** - file access isn't granted (see Requirements), or Site access isn't "On all sites".
- **Edits don't show on reload** - the `@require` is being cached. Set Tampermonkey -> *Settings* -> **Externals -> Update Interval** to anything other than "Never", or re-save the loader once to force a refetch. (On 5.5.6237 it was live even with "Never".)
- **Firefox** - not supported; use Chrome.
- **Stopped loading after a move/rename** - the loader shows "active" but nothing runs and no logs appear. The `@require file://` still points at the file's old path. Update it to the new location. (Moving a file has two coupling points: this loader path **and** the script's Greasy Fork sync URL, which also needs re-pointing - see the skill's [greasyfork-model](skills/greasyfork/references/greasyfork-model.md).)
- **`GM_… is not defined`, or a `GM_xmlhttpRequest` is blocked/empty** - the loader is missing the `@grant` (for that `GM_*` function) or the `@connect` (for the domain/redirect target). The target file's own header doesn't count; add them to the **loader** and reload.

## Relationship to production
The loader is **dev-only** and lives only in your Tampermonkey - it is not part of this repo. The real `.user.js` file is what gets published: it syncs to Greasy Fork via the [`greasyfork` skill](skills/greasyfork/) (see the README). Same source file, two consumption paths - local loader for development, Greasy Fork raw URL for release.

## Site-specific notes
- **Slack** (`app.slack.com`) - selectors, shared confirm-dialog scoping, SPA patterns, and the discovery probe, learned building scripts: [docs/slack-userscripts.md](docs/slack-userscripts.md).
