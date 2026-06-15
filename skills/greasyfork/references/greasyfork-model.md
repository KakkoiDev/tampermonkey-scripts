# Greasy Fork: how publishing actually works

Verified against Greasy Fork docs/behavior (2026). This is the mental model the scripts rely on.

## No write API
Greasy Fork exposes a **read-only** JSON API: `https://api.greasyfork.org/en/scripts/<id>.json` returns `version`, `name`, `code_url`, etc. There is **no** endpoint to create or update script code. Every write in this skill is therefore done by driving the real website in a local browser.

## Cloudflare => must run locally
Greasy Fork sits behind Cloudflare. The `cf_clearance` cookie is bound to the IP and User-Agent that solved the challenge. Automation must run on the **user's machine** (their IP) in a **real browser**; a server-side/curl request with copied cookies gets re-challenged and fails. Hence Puppeteer headful + a persisted profile, not an HTTP client.

## Auth = persisted browser profile
No API auth exists. `scripts/lib.mjs` launches Chromium with `userDataDir = ~/.cache/greasyfork/profile`. The user logs in once in the visible window; the session persists for later runs. `ensureLoggedIn` polls in a **separate background tab** (checking `users/webhook-info` for "Setting up a webhook") so the user's login tab is never reloaded mid-input.

## Updates are a PULL, gated on @version
1. Script source is hosted at a public GitHub **raw** URL.
2. Each script is set to **Source Syncing** with that URL + sync type **Automatic** (script's Admin page).
3. Greasy Fork re-fetches and republishes when notified. `@version` **must increase** or the fetch is a silent no-op ("Greasy Fork will warn if it's not incremented when the code changes").
4. A **per-user webhook** (`greasyfork.org/en/users/<id>-<name>/webhook`, content type `application/json`, push event, no secret) added to the repo (Settings -> Webhooks) is *supposed* to make pushes near-immediate. **Reality (observed 2026-06-15):** every delivery returns `403 Invalid HTTP Response` (`gh api repos/<o>/<r>/hooks/<id>/deliveries`), so auto-sync never fires and `set-sync` must be run after each push. Likely Greasy Fork's Cloudflare rejecting GitHub's server-side POST (consistent with the IP-binding above), or a stale webhook URL (re-fetch from `greasyfork.org/en/users/webhook-info`). The raw GitHub CDN can also lag ~5 min independently.
5. Files must be edited **in place** (committed, then modified) so webhook payloads show them as *modified*, not *added* - newly *added* files in a push are skipped by Greasy Fork's webhook handler.

## Moving or renaming a script's file
The sync URL is **path-based**. Moving or renaming a `.user.js` (e.g. into a `scripts/` folder) changes its raw URL, so the configured sync URL goes stale and the next sync 404s - the published listing then just keeps its last version (no data loss, but it stops updating). After any move/rename you MUST re-run `set-sync` for the affected scripts to re-point them at the new raw URL. Update the `file` field in `greasyfork.json` (the single source of the path); `set-sync` derives the new URL from it. Pure `git mv` renames don't bump `@version`, so nothing republishes - only the URL needs re-pointing.

## Stripped meta keys
Greasy Fork strips `@downloadURL`, `@updateURL`, `@installURL` and serves updates from its own `update.greasyfork.org` URLs. Don't bother setting them in source. `@namespace` + `@name` are the identity - changing either on update triggers a warning.

## Visibility (script type) - set at creation on /en/script_versions/new
Radio `script[script_type]`:
- `1` = **Public** user script (listed/searchable). Default.
- `2` = **Unlisted** ("not linked to from anywhere on Greasy Fork ... does not prevent others from accessing it if they know the URL"). Installable by direct link; excluded from search/listings. Sync + webhook work the same as public (confirmed).
- `3` = **Library** (intended to be `@require`-d, not installed directly).

## Form selectors (centralized knowledge; update here when Greasy Fork changes markup)
- New script: `/en/script_versions/new`. Code textarea `#script_version_code` (plain unless "Enable syntax-highlighting source editor" is checked - leave it off). Visibility radios `#script_script_type_1|2|3`. Submit `input[name="commit"]` ("Post script"). On success it redirects to `/en/scripts/<id>-<slug>`.
- Source syncing: script Admin page (`/en/scripts/<id>/admin` redirects to the slug). URL field `#script_sync_identifier`, sync-type radio `#script_sync_type_automatic`, submit `input[name="update-and-sync"]` ("Update and sync now").
- All forms carry a Rails `authenticity_token` hidden field - submitting via a real button click sends it automatically.
