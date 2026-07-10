---
name: create-userscript
description: Scaffold a new Tampermonkey userscript and its dev loader, then build the feature. Generates scripts/<slug>.user.js with a filled metadata header, verifies the target-site favicon, registers it in greasyfork.json + the README table when those exist, and prints the dev-loader block to paste into Tampermonkey for live reload. Use when creating a new userscript / greasemonkey script, adding a feature to a website via Tampermonkey, or starting a *.user.js from scratch. Triggers - "new userscript", "create a tampermonkey script", "scaffold a userscript", "add a feature to <site> with tampermonkey".
license: MIT. See LICENSE.txt
metadata:
  author: cyril.antoni
  version: "1.0"
---

# create-userscript

Scaffold a new Tampermonkey userscript, then build the feature into it. Run the scaffolder from the **root of a userscript repo** (a repo of `scripts/*.user.js` files). Needs **Node 18+** (uses global `fetch`).

## 1. Scaffold the file

```
node skills/create-userscript/scripts/new-userscript.mjs \
  --name "Slack Quick Edit" \
  --match "https://app.slack.com/*" \
  --desc "Double-click your own Slack message to edit it"
```

- Required: `--name`, `--match`, `--desc`.
- Repeatable (pass again or comma-split): `--match`, `--grant`, `--connect`, `--require`.
- Optional: `--slug` (default: slugified name), `--dir` (default `scripts`), `--author` (default: `git config user.name`), `--icon` (override the favicon guess).

What it does:
- Writes `scripts/<slug>.user.js` with the metadata header in the conventional field order and a minimal IIFE body. Refuses to overwrite an existing file.
- **Favicon:** unless `--icon` is given, it guesses `https://<host>/favicon.ico` from the first `@match` and verifies it returns `200` + an `image/*` type. If it fails to verify, it warns - fix `@icon` by hand (never ship a script without a real, rendering icon).
- **If a `greasyfork.json` manifest exists:** appends `{ file, name, blurb }` and regenerates the README table via `tools/gen-readme.mjs`. Absent those files, it skips both steps - the `.user.js` and dev loader still work, so this runs in any repo.
- Prints the **dev-loader block** to paste into Tampermonkey.

## 2. Test with the dev loader

The scaffolder prints a dev loader - a tiny Tampermonkey script that `@require`s the file from disk so edits live-reload. The **loaded file's own header is ignored at runtime**; the loader is what Tampermonkey reads. The scaffolder already copies every `@match`, `@grant`, `@connect`, and external `@require` onto the loader (CDN `@require`s before the `file://` line). Paste it into a new Tampermonkey script; if you later change the real script's `@match`/`@grant`/`@connect`/`@require`, update the loader to match.

## 3. Build the feature

The scaffolded body is a stub (`// TODO`). Now write the actual feature. Rules that save you:

- **Placing UI on obfuscated sites (Google, Slack, Notion, ...):** don't guess hashed class names. Get the target element's `outerHTML` from the user, or render the page headless and inspect it, before deciding where to inject. Anchor on stable attributes (`aria-label`, `name`, `role`, `data-qa`), never hashed classes. Position injected UI `absolute`/`fixed` against the anchor's rect so it doesn't reflow the page.
- **Debugging on a logged-in site you can't see:** don't patch placement blind twice. Add a temporary `console.log` behind a `const DEBUG = true;` block in the real file, have the user reload and paste the output, then strip it before committing. In-file logs see the actual code path and runtime state (hover-only UI, hidden chars, which branch ran) that static HTML won't reveal.
- **Verify placement with a screenshot before committing** when the UI lands on a real site.
- **`@grant`:** if the feature needs `GM_setValue`/`GM_xmlhttpRequest`/etc., pass them at scaffold time (`--grant`) or add them to the header - and mirror them onto the dev loader, or the API is `undefined` at runtime.

## 4. Publish (optional)

If the repo uses Greasy Fork, hand off to the `greasyfork` skill to register and sync. This skill only scaffolds and builds; it does not publish.

## Portability

Self-contained: the scaffolder and this SKILL.md carry everything needed. The `greasyfork.json`/README integration is auto-detected - present in the origin repo, skipped elsewhere. Copy the `skills/create-userscript/` directory into any userscript repo to use it there.
