---
name: greasyfork
description: Manage userscripts on Greasy Fork (greasyfork.org) from a git repo - verify that pushed changes synced, publish/register new scripts, and configure sync-from-URL + webhooks. Use when publishing a userscript to Greasy Fork, checking whether a Greasy Fork script is up to date with its repo, wiring a repo so pushes auto-update Greasy Fork, or setting a script's visibility (public/unlisted/library). Greasy Fork has no write API - reads use its public JSON API, writes drive a local browser. Triggers - "publish to greasyfork", "is my greasyfork script in sync", "register a userscript", "set up greasyfork sync".
license: MIT. See LICENSE.txt
metadata:
  author: cyril.antoni
  version: "1.1"
---

# greasyfork

Publish and keep userscripts in sync on Greasy Fork from a git repo. Run the scripts below from the **root of a userscript repo** that contains a `greasyfork.json` manifest.

## Before publishing: test with a dev loader
New scripts are tested locally via a **dev loader** - a tiny Tampermonkey script that `@require`s the file from disk (see [DEVELOPMENT.md](../../docs/DEVELOPMENT.md)). **Whenever you create a new `scripts/*.user.js`, always produce its filled-in dev loader block** so it can be tested before publishing. The loaded file's header is ignored at runtime, so copy every `@match`, `@grant`, `@connect`, and external `@require` onto the loader (CDN `@require`s before the `file://` line).

## Placing UI on obfuscated sites
When a script injects UI into a site with hashed class names (Google, Slack, Notion), don't guess selectors. Get the target element's `outerHTML` from the user, or render the page headless with Puppeteer and screenshot, before committing placement. Anchor on stable attributes (`aria-label`, `name`, `role`, `data-qa`), never hashed classes, and position overlays `absolute`/`fixed` so they don't shift the page. Fuller checklist in the repo's CLAUDE.md; Slack specifics in [docs/slack-userscripts.md](../../docs/slack-userscripts.md).

## The model (read [references/greasyfork-model.md](references/greasyfork-model.md) before writing)
- **No write API.** Reads use the public JSON API (`api.greasyfork.org/en/scripts/<id>.json`). Writes (register, set-sync, set-visibility) are done by driving the real site in a local browser, because Cloudflare is bound to the user's IP - it must run on the user's machine.
- **`@version` must increase** on every change or Greasy Fork ignores the update (a no-op). The host repo's `pre-commit` hook handles this.
- **Sync model:** Greasy Fork *pulls* the raw GitHub URL. A per-user webhook (repo Settings -> Webhooks, URL from `greasyfork.org/en/users/webhook-info`) makes pushes near-immediate; otherwise periodic.
- **`@downloadURL`/`@updateURL` are stripped** by Greasy Fork - leave them out.

## Prerequisites
- A `greasyfork.json` in the cwd. Schema + examples: [references/manifest.md](references/manifest.md). Owner/repo/branch are derived from `git remote` - never hardcode them.
- Browser tools only: one-time `npm install` in this skill's `scripts/` dir (installs Puppeteer; Chromium is cached under `~/.cache/puppeteer`).
- Browser tools log in once via a persisted profile (`~/.cache/greasyfork/profile`). The first write opens a visible window on the sign-in page; log in (any method) and it continues automatically. The login tab is never reloaded.

## Commands (run from the repo root)
| Task | Command | Auth |
|---|---|---|
| Check everything is in sync | `node skills/greasyfork/scripts/verify.mjs` | none |
| Wire/refresh sync for scripts | `node skills/greasyfork/scripts/set-sync.mjs [id\|file\|all]` | browser |
| Publish a new script | `node skills/greasyfork/scripts/register.mjs <file.user.js>` | browser |
| List what's syncing | `node skills/greasyfork/scripts/status.mjs` | browser |

`verify` is the source of truth and works even if the browser tools break - prefer it for "did it sync?".

## Recipes
- **Did my push land?** -> `verify.mjs`. `OK` = local == published == raw. `DRIFT` = investigate (version not bumped, CDN lag ~5 min, or webhook not delivered).
- **Publish a new script:** push the `.user.js` to GitHub **first** (`set-sync`'s immediate sync fetches the raw URL and 404s if the file isn't there yet) -> add an entry to `greasyfork.json` with `"id": null` and the desired `visibility` (`public`|`unlisted`|`library`) -> `register.mjs <file>` (creates the listing, pastes the code, writes the id back into the manifest) -> `set-sync.mjs <id>` -> `verify.mjs` -> **commit the manifest and push** (the written-back id is what flips the README row from "not yet published" to the Greasy Fork link, via this repo's `gen-readme` pre-commit hook). New visibility usually matches its sibling scripts (the GitHub PR tools are `public`).
- **Wire an already-published script:** ensure its entry has the real `id` -> `set-sync.mjs <id>`.

## Cautions
- `register.mjs` creates a REAL listing. It refuses to run if the manifest entry already has an `id` (prevents duplicates). Confirm the new id afterward.
- The write tools DOM-scrape Greasy Fork's forms; they will break when Greasy Fork changes its markup. Selectors are centralized in the scripts. `verify.mjs` (public API) is the stable fallback.
