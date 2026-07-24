# Local development (live reload)

Edit a userscript file on disk, reload the page, see the change - no copy-paste into Tampermonkey, no Greasy Fork round-trip. Confirmed working on Tampermonkey 5.5.6237 (Chrome).

> **New script? Ship its dev loader with it.** Every script in `scripts/` is tested through a dev loader (below). When you add one, produce its loader block filled in from the script's own metadata - copy every `@match`, `@grant`, `@connect`, and external `@require` onto the loader, since the loaded file's header is ignored at runtime.

## How it works (the mechanism)

The real code stays **on disk**; a small **dev loader** stays in Tampermonkey. The loader's last line is the linchpin:

```javascript
// @require      file:///Users/cyril.antoni/Code/webmods/scripts/<script>.user.js
```

That `@require file://<absolute path>` makes Tampermonkey load the on-disk file as a library **every time a matching page loads**. So the disk file is the single source of truth, and the edit-test cycle is:

1. **Claude Code (or you) edits** `scripts/<script>.user.js` on disk.
2. **You reload the page.** Tampermonkey re-reads the `file://` `@require` and runs the new code - **no copy-paste into Tampermonkey, no Greasy Fork round-trip.**

Precise wording matters: it is **pulled on page reload, not live-pushed**. Tampermonkey does not watch the file and refresh the tab for you; nothing reaches the browser until you reload (and even then the external can be cached - see [Troubleshooting](#troubleshooting)). The loader's own `// ==UserScript==` header is what Tampermonkey reads for `@match`/`@grant`/etc.; the required file's header is ignored at runtime.

## Requirements
- **Chrome** (or a Chromium browser). Loading userscripts from `file://` does **not** work in Firefox.
- **Tampermonkey 5.5.0+** (re-reads a local `file://` `@require` on page reload; older versions cache the first copy and never pick up disk edits).
- **Grant file access**: `chrome://extensions` -> Tampermonkey -> *Details* -> turn on **"Allow access to file URLs"**, and set **Site access -> "On all sites"**.

## One-time setup per script
One dev loader per script, created once in Tampermonkey. Steps:

1. Tampermonkey dashboard -> **Create a new script** (the `+` tab).
2. Delete the template, paste the **dev loader** block below.
3. Fill every `<...>` placeholder from the real script's own metadata - leave none behind.
4. Point `@require file://` at the script's **absolute** on-disk path (e.g. `file:///Users/cyril.antoni/Code/webmods/scripts/<script>.user.js`).
5. **Save** (Cmd/Ctrl+S), and **disable any published/synced copy** of the same script so it doesn't run twice alongside the loader.

The loader pulls the real file from disk:

```javascript
// ==UserScript==
// @name         DEV: <Script Name> (local)
// @namespace    http://tampermonkey.net/
// @icon         <copy from the real script (target site favicon)>
// @version      0.0.1
// @description  dev loader
// @match        <copy from the real script>
// @grant        <copy EVERY @grant from the real script, incl. GM_* ones>
// @connect      <copy every @connect, if it uses GM_xmlhttpRequest>
// @run-at       <copy if the real script sets it>
// @require      file:///absolute/path/to/scripts/<script>.user.js
// ==/UserScript==
```

`@name`, `@namespace`, `@version`, and `@description` are all required by the userscript linter (`eslint-plugin-userscripts`, which Tampermonkey's editor runs) - `@description` is the one people forget; any text works. Everything else above is needed at runtime. `@icon` is cosmetic - copy the real script's (the target-site favicon) so the loader is easy to spot in the Tampermonkey dashboard.

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
// @icon         https://github.githubassets.com/favicons/favicon-dark.png
// @version      0.0.1
// @description  dev loader
// @match        https://github.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      github.com
// @connect      githubusercontent.com
// @require      file:///Users/cyril.antoni/Code/webmods/scripts/github-pr-copy-diff.user.js
// ==/UserScript==
```

### Scripts that `@require` an external library
If the real script pulls a library from a CDN (e.g. `scripts/google-emoji-blast.user.js` uses `emoji-blast`), the loader needs that `@require` **too**, listed **before** the `file://` line so the library loads first:
```javascript
// @require https://cdn.jsdelivr.net/npm/emoji-blast@0.11.0/dist/global.js
// @require file:///ABSOLUTE/PATH/scripts/google-emoji-blast.user.js
// ==/UserScript==
```

## The loop
1. **Claude Code (or you) edits** the real `scripts/<script>.user.js` on disk.
2. **Reload the page.** Tampermonkey re-reads the `file://` `@require` and runs the new code. You do **not** re-save the loader, and you do **not** paste anything into Tampermonkey.
3. The change is live.

Tip: add `console.log('[my-script] vN loaded')` and bump `N` to confirm reloads are picking up your edits. Keep destructive actions behind a `DRY_RUN` flag while iterating.

### Debugging cycle with the LLM (logged-in sites)
Claude can't see an authenticated page, so the round-trip is:

1. **Claude edits the script** - adds the fix, or temporary `console.log`s behind a `const DEBUG = true;` block (instrument **in the file**, never a standalone console snippet - the file is already live-reloading; see [Debugging on a logged-in site](#debugging-on-a-logged-in-site)).
2. **You reload the tab**, reproduce the behaviour.
3. **You copy/paste back** the DOM (right-click the element -> Inspect -> Copy -> **Copy element**) and/or the relevant console lines. Console context must be `top` (see [slack-userscripts.md](slack-userscripts.md#discovering-selectors)).
4. **Claude reads the output**, confirms or rejects the hypothesis, and edits again. Repeat until fixed, then strip the `DEBUG` block.

This is how the `slack-todo-emoji` repaint bug was found: three paint-timing hypotheses were all refuted by one pasted-back log that showed the live node was fine but its `background-image` URL was wrong.

## Troubleshooting
- **"Not allowed to load local resource" / nothing loads** - file access isn't granted (see Requirements), or Site access isn't "On all sites".
- **Edits don't show on reload** - the `@require` is being cached. Set Tampermonkey -> *Settings* -> **Externals -> Update Interval** to anything other than "Never", or re-save the loader once to force a refetch. (On 5.5.6237 it was live even with "Never".)
- **Firefox** - not supported; use Chrome.
- **Stopped loading after a move/rename** - the loader shows "active" but nothing runs and no logs appear. The `@require file://` still points at the file's old path. Update it to the new location. (Moving a file has two coupling points: this loader path **and** the script's Greasy Fork sync URL, which also needs re-pointing - see the skill's [greasyfork-model](../skills/greasyfork/references/greasyfork-model.md).)
- **`GM_… is not defined`, or a `GM_xmlhttpRequest` is blocked/empty** - the loader is missing the `@grant` (for that `GM_*` function) or the `@connect` (for the domain/redirect target). The target file's own header doesn't count; add them to the **loader** and reload.

## Relationship to production
The loader is **dev-only** and lives only in your Tampermonkey - it is not part of this repo. The real `.user.js` file is what gets published: it syncs to Greasy Fork via the [`greasyfork` skill](../skills/greasyfork/) (see the README). Same source file, two consumption paths - local loader for development, Greasy Fork raw URL for release.

## Icons
Every script gets an `@icon` (the target site's favicon) so it's identifiable in the Tampermonkey dashboard - on the real script **and** its dev loader.
- Prefer the site's own stable favicon: `https://<host>/favicon.ico` (e.g. `https://app.slack.com/favicon.ico`, `https://meet.google.com/favicon.ico`).
- Verify before committing: `curl -s -o /dev/null -w "%{http_code} %{content_type}" -L <url>` must return `200` and an `image/*` type.
- No `/favicon.ico`? Read the site's `<link rel="icon">` (`curl -sL <site> | grep -i 'rel="[^"]*icon'`), but skip version-hashed asset paths (e.g. `a.slack-edge.com/e6a93c1/...`) - they rot.
- Avoid Google's `s2/favicons` proxy - Tampermonkey often won't render it in the dashboard. Inline `data:` URI is the always-works fallback.

## Verify on the real page (headless)
When you can't eyeball a change - or to check element placement on an obfuscated site without your own browser - drive headless Chrome with the Puppeteer the `greasyfork` skill already installs. Load the page and inject the library + your script via `page.evaluate` (it runs in the page's JS context, so it bypasses the site's CSP the way Tampermonkey does), then screenshot and look:
```js
// save under skills/greasyfork/scripts/ (so 'puppeteer' resolves); run from the repo root
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
const lib = await (await fetch('https://cdn.jsdelivr.net/npm/<dep>')).text(); // only if the script @requires one
const src = readFileSync('scripts/<name>.user.js', 'utf8');
const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto('https://example.com/', { waitUntil: 'networkidle2' });
await p.evaluate(lib); await p.evaluate(src);
await p.screenshot({ path: '/tmp/out.png' });
await b.close();
```
Caveat: headless gets the **logged-out** page - great for public pages (e.g. the Google homepage), useless for anything behind auth (Slack). For those, get the DOM from the user (Inspect -> Copy element) instead.

## Debugging on a logged-in site

You can't see an authenticated page (headless is logged out), so **the user is your eyes - ask them for the DOM, and instrument rather than guess**. Two kinds of ask:
- **Static structure** - ask for the target's `outerHTML` (right-click -> Inspect -> Copy -> **Copy element**, not a big ancestor). Anchor selectors on what you see, never on a guess.
- **Runtime state you can't get from static HTML** - hover-only controls, hidden characters, or *which branch of your code actually ran*. Drop a temporary `console.log` (the element's `outerHTML`, a flag, the caret node) and have the user paste the output. Console context must be `top` (see [slack-userscripts.md](slack-userscripts.md#discovering-selectors)).

When a fix "doesn't work," resist patching blind a second time - **log the state and read it**. Two of the nastier `slack-todo-emoji` bugs (Quill's invisible `\uFEFF` embed anchors; Quill ignoring programmatic multi-node ranges) were impossible to see in the static DOM and only surfaced once the relevant `textContent` / code path was logged. Strip the instrumentation before committing.

**Instrument inside the real `.user.js`, not a standalone console snippet.** The dev loader `@require file://`s the on-disk script, so edits live-reload into the page in the script's own closure. Add the `console.log`s straight into the file (gate them behind a `const DEBUG = true;` block so removal is one deletion), have the user reload the tab and paste the output, then strip the block. This beats a paste-into-console probe: the logs come from the **actual code path** - which branch ran, the real `forceRepaint`/observer/`muting` state - not a re-implementation observing from outside that can only guess at internal state. The default debug round-trip here is: you edit the file -> user reloads the Slack tab -> user copy/pastes the console -> you read it. (Cyril always runs scripts via local-file dev loaders - assume this; never hand over a standalone snippet when the file is already live-reloading.)

## Clipboard: rich + plain copy (one button, every paste target)

When a "copy" button must paste well into both rich editors (Slack, Notion) and plain ones (markdown files, code editors), write **multiple clipboard flavors at once**. The clipboard holds several representations of one copy; each paste target picks the richest flavor it understands. Use `navigator.clipboard.write()` with a `ClipboardItem` (not `GM_setClipboard`, which writes a single plain flavor only):

```js
await navigator.clipboard.write([ new ClipboardItem({
  'text/html':  new Blob([html], { type: 'text/html'  }), // <a href="url">Title</a>
  'text/plain': new Blob([url],  { type: 'text/plain' }), // the bare URL
}) ]);
```

Put the **rich anchor in `text/html`** (so the label/title shows as the link text) and the **bare URL in `text/plain`**. Who reads what (learned building `github-pr-copy-title-link`, mirroring Notion's native "Copy link"):
- **Slack, Notion** - consume `text/html`, render the `<a href>` as a named link showing the title. Never look at `text/plain`.
- **Plain / dumb editors** (markdown files, `<textarea>`, anything with no rich paste) - read ONLY `text/plain` -> they get the **URL**, a working link, not unlinked title text.

The trap to avoid: do NOT put a full markdown link `[label](url)` in `text/plain`. Editors with "paste as link" (VS Code `.md`, Notion pages) treat `text/plain` as the link text and add the `text/html` href themselves, so a markdown `text/plain` gets wrapped **again** -> `[[label](url)](url)`. A bare URL in `text/plain` has nothing to double-wrap.

Tradeoff that remains: a smart md editor shows the **URL** as the link text, not the title (it used `text/plain`). Acceptable - the link works everywhere, and rich targets still show the title. If you instead want the title as the markdown label, put the bare *label* in `text/plain`, but then plain editors get unlinked text with no URL. Pick which matters; URL-in-plain is the better default.

Requirements: `navigator.clipboard.write` needs a secure context (https), transient user activation (call it from a click handler), and document focus. No GM grant needed; `@grant none` is fine since there's no `GM_*` call and no cross-origin fetch.

## Feeding fake camera/mic into a meeting (`getUserMedia` override)

A userscript **cannot** create an OS-level virtual device (that needs native software like OBS Virtual Cam / VB-Cable). It **can** override `navigator.mediaDevices.getUserMedia` so a meeting tab receives a synthetic `MediaStream` instead of real hardware. Learned building `virtual-media-injector` (plays a video into webcam+mic during a call, with a live toggle back to the real camera). Confirmed on Google Meet.

The shape that survives a mid-call toggle: hand the app **one stable stream you own**, then swap its content live. The app acquires media once and never re-acquires, so a direct "return the clip stream" only works if armed before joining.
- **video track** = `canvas.captureStream(30)`; a `requestAnimationFrame` loop draws either the real camera `<video>` (passthrough) or the clip `<video>`, chosen by a `playing` flag.
- **audio track** = a WebAudio `MediaStreamDestination`; the real mic and the clip each pass through a `GainNode`, and you crossfade by flipping the gains.

The gotchas, in the order they bite:
- **Override through `unsafeWindow`.** Any `GM_*` grant sandboxes the script, so patch `unsafeWindow.navigator.mediaDevices.getUserMedia`, not the sandbox's copy. (With `@grant none` you'd patch `window` directly, but you usually need `GM_xmlhttpRequest` - see below.)
- **`@run-at document-start`** - you must replace `getUserMedia` before page code caches a reference to it.
- **Cross-origin video taints `captureStream()`** and WebRTC silently drops a tainted track. A remote sample file with no `Access-Control-Allow-Origin` can't be a `<video src>` directly. Fetch it with `GM_xmlhttpRequest` (bypasses CORS) -> `Blob` -> `URL.createObjectURL` -> same-origin, untainted. Files chosen via `<input type=file>` are already `blob:` and need no GM.
- **Google Meet calls `getUserMedia` separately for audio and video** (`{audio:true,video:false}` then `{audio:false,video:true}`), not once for both. A single cached build virtualizes only the first call, so the toggle appears to "do nothing" for the other track. Build the audio and video pipelines **independently and lazily**, each surviving across calls. (Plain `getUserMedia` test pages request both at once, so they hide this bug - test on the real app.)
- **`AudioContext` starts suspended** under the autoplay policy, so even mic passthrough is silent until `ctx.resume()`. Resume eagerly and again on the first `pointerdown`/`keydown`.
- **`createMediaElementSource` runs once per element and binds to the element, not the resource.** To change the clip later, swap `videoEl.src` - the audio routing follows and no graph rebuild is needed (this is what makes a file picker cheap).

Verifying headless (catches runtime throws before you load it into a real call):
- `navigator.mediaDevices` is **absent on `about:blank`** (not a secure context). Serve the test page from `localhost` (treated as secure).
- Launch Chrome with `--use-fake-device-for-media-stream`, mimic `document-start` with `page.evaluateOnNewDocument(scriptSrc)`, and shim `GM_xmlhttpRequest` to hand the real mp4 bytes back as a `Blob`.
- To tell a virtual track from a real one: the WebAudio audio track has `label === 'MediaStreamAudioDestinationNode'`; the canvas video track reports `resizeMode:'none'` plus the canvas size (the fake camera defaults to 640x480). `deviceId` is **not** a discriminator - both carry one.

Limitations to mention to anyone using this: `requestAnimationFrame` throttles when the tab is backgrounded (video freezes for viewers); the clip is stretched to the camera-sized canvas (aspect ratio not preserved); and `@match *://*/*` routes your real mic/cam through the graph on every media-using site - narrow the match to lower the blast radius.

## Site-specific notes
- **Slack** (`app.slack.com`) - selectors, shared confirm-dialog scoping, SPA patterns, the discovery probe, and the message-edit flow, learned building scripts: [slack-userscripts.md](slack-userscripts.md).
