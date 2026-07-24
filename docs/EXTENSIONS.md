# Companion Chrome extensions

Some userscripts are also shipped as Chrome extensions so people can install them in one click, without setting up Tampermonkey. The userscript stays the **single source of truth**; the extension is a generated build output.

## The rule: edit the userscript, never the generated extension code

- You only ever edit `scripts/<name>.user.js`. The extension's content-script `.js` is **generated** from it, with a `// GENERATED ... do not edit` banner.
- The extension's `manifest.json` is hand-written (it holds extension-only metadata: `world`, `matches`, `run_at`, permissions). Its `version` is **auto-synced** from the userscript's `@version` by the generator.
- `tools/build-extensions.mjs` does the generation. Each `extensions/<name>/source.json` points it at the source: `{ "userscript": "scripts/<name>.user.js", "out": "<name>.js" }`.
- The **pre-commit hook** (`.githooks/pre-commit`) runs the generator on every commit that touches a `.user.js` or a `source.json` and re-stages the output - so the extension copy can never drift from the source, exactly like `gen-readme` keeps the README table in sync with `greasyfork.json`.
- Hand-authored extensions with **no `source.json`** (e.g. `csp-unlock`) are left untouched by the generator.
- Chrome regenerates a `_metadata/` folder when it loads an unpacked extension; it is gitignored per extension.

## Add a new companion extension from a userscript

1. `mkdir extensions/<name>/`
2. Write `extensions/<name>/manifest.json` (MV3), mapping the userscript header:
   - `@match` -> `content_scripts[].matches`
   - `@run-at` -> `run_at` (`document-start` -> `document_start`)
   - **`world`**: use `"MAIN"` if the script needs the page's realm - reading page globals, or hooking the page's own `fetch`/`XMLHttpRequest` (e.g. `notion-comment-recovery`). Use the default isolated world only for pure DOM scripts. `world: "MAIN"` needs `"minimum_chrome_version": "111"`.
   - `@grant`: `@grant none` needs nothing. `GM_*` grants need shims (`GM_setValue` -> `chrome.storage`, `GM_setClipboard` -> clipboard API, `GM_xmlhttpRequest` -> extension `fetch` + `host_permissions`). Note: `chrome.*` APIs exist only in the isolated world, so a script needing **both** MAIN world and `chrome.storage` can't have both - resolve per script.
3. Write `extensions/<name>/source.json` pointing at the userscript.
4. Add `extensions/<name>/.gitignore` containing `_metadata/`.
5. Run `node tools/build-extensions.mjs` to generate the `.js` (or just commit - the hook does it).
6. Load unpacked (`chrome://extensions` -> Developer mode -> Load unpacked) to test. If the userscript version injects into the same world, disable it first (e.g. scripts guarded by a global like `__NOC_ARMED__` let only the first instance win).

## Distribution channels

Colleagues can't freely sideload on Chrome, so "which store" matters. As of 2026-07:

| Channel | Reach | Notes |
|---|---|---|
| **Chrome Web Store** | Chrome/Chromium, one click | Main channel. $5 dev account, review (days). Broad host permissions get extra scrutiny; **CSP-disabling / "exotic" extensions (like `csp-unlock`) will likely be rejected.** |
| **Microsoft Edge Add-ons** | Edge, one click | Accepts the **same Chromium code**, separate (often faster) review. Useful as a parallel channel while Chrome review is pending. Same rejection risk for exotic extensions. |
| **Firefox AMO + self-distribution** | Firefox, one click | Closest thing to "F-Droid freedom": you can **self-distribute a signed XPI** (submit to AMO as *unlisted* for signing, host the file yourself, users install via web download). Firefox permits what Chrome forbids - **the venue for exotic extensions**. Cost: porting to Firefox's WebExtension quirks (`world:MAIN`, `declarativeNetRequest`, and MV3 details differ from Chrome). |
| **Enterprise force-install** | Managed browsers only | Chrome/Edge admins can force-install a non-store `.crx` from a self-hosted URL via policy (machines must be domain-joined). The path if colleagues are on managed Chrome. |

Key realities:
- **There is no F-Droid-equivalent open store for Chrome.** Chrome auto-disables sideloaded `.crx`; non-store installs are dev-mode (with a startup nag) or enterprise force-install only. Self-distribution freedom lives on **Firefox**.
- **Reach follows the browser.** An Edge or Firefox listing only helps colleagues who use that browser.
- **For faster iteration / exotic extensions:** Edge (parallel review, same code) for speed; Firefox self-hosted signed XPI for anything Chrome/Edge reject.

## Open idea: rename the project

If the extension-building path proves out, "tampermonkey-scripts" undersells it (it would hold userscripts **and** generated extensions). A candidate name floated: **ExtensionMonkey**.

Before renaming, weigh:
- **Greasy Fork sync breaks.** Every published script syncs from a raw GitHub URL containing the repo name (`raw.githubusercontent.com/<owner>/tampermonkey-scripts/...`). Renaming the repo requires re-pointing every script's sync-from-URL (`node skills/greasyfork/scripts/release.mjs all`); GitHub redirects are not safe to rely on for raw URLs.
- **Also update:** the git remote and README. (`greasyfork.json` derives owner/repo from `git remote`, so that follows automatically.)
- **Name connotation:** the `-monkey` family (Tampermonkey, Violentmonkey, Greasemonkey) are userscript *managers*. "ExtensionMonkey" reads like another manager, not a repo of scripts + generated extensions. Prefer a name that says what it is.

Defer the rename until the path is proven: an extension loads and works in Chrome, and the generator has produced a few extensions cleanly.
