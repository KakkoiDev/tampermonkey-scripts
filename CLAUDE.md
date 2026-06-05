# Tampermonkey scripts - project instructions

## Always: dev loader block for new scripts

When you create a new userscript (`scripts/*.user.js`), ALWAYS output its **dev loader** block, filled in from the script's own metadata (no placeholders left), so the user can test it with live reload. This is required for testing - deliver it as part of any new script, without being asked.

```javascript
// ==UserScript==
// @name         DEV: <Script Name> (local)
// @namespace    http://tampermonkey.net/
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

## Placing UI on obfuscated DOM (Google, Slack, Notion, ...)

Sites with hashed/minified class names (e.g. Google's `lnXdpd`) will burn you if you guess selectors. Before writing or adjusting where a script injects UI:

1. **Get the real element first** - ask the user for the target's `outerHTML`, or render the page headless and inspect it (Puppeteer is installed under `skills/greasyfork/scripts/node_modules`: load the URL, inject the library + script via `page.evaluate` to bypass page CSP, then screenshot).
2. **Anchor on stable attributes** - `aria-label`, `name`, `role`, `data-qa` - never hashed classes.
3. **Overlay without reflow** - position the injected element `absolute`/`fixed` against the anchor's rect; in-flow insertion shifts the page (it pushed Google's logo down).
4. **Verify with a screenshot before committing** - don't ship placement you haven't seen.
