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

Full guide and gotchas: [DEVELOPMENT.md](DEVELOPMENT.md). Publishing: [PUBLISHING.md](PUBLISHING.md) + the `greasyfork` skill.
