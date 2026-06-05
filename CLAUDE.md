# Tampermonkey scripts - project instructions

## Always: dev loader block for new scripts

When you create a new userscript (`scripts/*.user.js`), ALWAYS output its **dev loader** block, filled in from the script's own metadata (no placeholders left), so the user can test it with live reload. This is required for testing - deliver it as part of any new script, without being asked.

```javascript
// ==UserScript==
// @name         DEV: <Script Name> (local)
// @namespace    http://tampermonkey.net/
// @icon         <target site favicon, copied from the script>
// @version      0.0.1
// @description  dev loader
// @match        <every @match from the script>
// @grant        <every @grant from the script, incl. GM_* and `none`>
// @connect      <every @connect from the script, if any>
// @require      <each external/CDN @require, in order, BEFORE the file line>
// @require      file:///ABSOLUTE/PATH/scripts/<script>.user.js
// ==/UserScript==
```

The loaded file's own header is IGNORED at runtime - the loader is what Tampermonkey reads. So:
- Copy every `@match`, `@grant` (including `GM_*` and `none`), and `@connect` onto the loader.
- Put external `@require` (CDN libs) BEFORE the `@require file://` line, in dependency order.
- Use the absolute on-disk path for the `file://` require.

Full guide and gotchas: [DEVELOPMENT.md](docs/DEVELOPMENT.md). Publishing: [PUBLISHING.md](docs/PUBLISHING.md) + the `greasyfork` skill.

## New scripts: target-site `@icon`

Every script (and its dev loader) carries an `@icon` of the target site's favicon, so it's identifiable in the Tampermonkey dashboard. Put it right after `@namespace`. Always fetch a real icon for a new script - never ship without one, never guess the URL.

How to get the right URL:
1. Prefer the site's own stable favicon: `https://<target-host>/favicon.ico` (e.g. `https://app.slack.com/favicon.ico`, `https://meet.google.com/favicon.ico`).
2. Verify before committing - `curl -s -o /dev/null -w "%{http_code} %{content_type}" -L <url>` must return `200` and an `image/*` type.
3. No `/favicon.ico`? Read the site's `<link rel="icon">`: `curl -sL <site> | grep -i 'rel="[^"]*icon'` - but skip version-hashed asset paths (e.g. `a.slack-edge.com/e6a93c1/...`), they rot.
4. Avoid Google's `s2/favicons` proxy - Tampermonkey often won't render it in the dashboard. Last resort: an inline `data:` URI of the logo (always renders, no network).

## Placing UI on obfuscated DOM (Google, Slack, Notion, ...)

Sites with hashed/minified class names (e.g. Google's `lnXdpd`) will burn you if you guess selectors. Before writing or adjusting where a script injects UI:

1. **Get the real element first** - ask the user for the target's `outerHTML`, or render the page headless and inspect it (Puppeteer is installed under `skills/greasyfork/scripts/node_modules`: load the URL, inject the library + script via `page.evaluate` to bypass page CSP, then screenshot).
2. **Anchor on stable attributes** - `aria-label`, `name`, `role`, `data-qa` - never hashed classes.
3. **Overlay without reflow** - position the injected element `absolute`/`fixed` against the anchor's rect; in-flow insertion shifts the page (it pushed Google's logo down).
4. **Verify with a screenshot before committing** - don't ship placement you haven't seen.
