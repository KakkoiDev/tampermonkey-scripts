# Publishing & using as a template

This repo publishes its userscripts to [Greasy Fork](https://greasyfork.org/) and doubles as a reusable template for managing your own. Day-to-day building lives in the [README](../README.md) and [DEVELOPMENT.md](DEVELOPMENT.md); this doc covers release and reuse.

## How publishing works

There is no write API for Greasy Fork. Updates flow by Greasy Fork **pulling** the raw file from this repo:

1. Edit a `.user.js` file.
2. Commit. A `pre-commit` hook bumps `@version` to today's date (`YYYY.MM.DD`, with a `.N` suffix for same-day re-commits). Greasy Fork ignores any update whose `@version` is not incremented, so this is mandatory.
3. Push to `main`.
4. A repo webhook is supposed to ping Greasy Fork to re-fetch the raw file. It does **not** work: the webhook endpoint returns **403** to every POST and the failure is server-side at Greasy Fork (diagnosed 2026-06-15 - see [Sync troubleshooting](#sync-troubleshooting) and the skill's [greasyfork-model](../skills/greasyfork/references/greasyfork-model.md)). So Greasy Fork never auto-pulls. After every push, run **`release`** to force the pull and verify:

   ```sh
   git push && node skills/greasyfork/scripts/release.mjs
   # or let it push for you:
   node skills/greasyfork/scripts/release.mjs --push
   ```

Each script is wired on its Greasy Fork **Admin -> Source Syncing** page with the raw URL `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<file>.user.js` and sync type "Automatic". `@downloadURL` / `@updateURL` are intentionally absent: Greasy Fork strips them and serves updates from its own URLs.

## Managing publishing

`greasyfork.json` maps each local file to its Greasy Fork script id and visibility. The bundled **`greasyfork` skill** (in [`skills/greasyfork/`](../skills/greasyfork/); discovered by Claude Code via `~/.claude/skills/`, and by pi/Codex/OpenCode via the repo's [`.agents/skills/`](../.agents/skills/)) drives Greasy Fork from this manifest (owner/repo/branch are derived from `git remote`, nothing hardcoded):

- **verify** (read-only, no login): check that every script's local `@version` matches the published and raw-served versions.
  `node skills/greasyfork/scripts/verify.mjs`
- **release**: sync every script whose published version is behind the local file, then verify - the one-command post-push step (the webhook is dead, see below). `--push` pushes first.
  `node skills/greasyfork/scripts/release.mjs [--push]`
- **set-sync**: configure sync-from-URL + Automatic and trigger an immediate sync for specific scripts.
  `node skills/greasyfork/scripts/set-sync.mjs [id|file|all]`
- **register**: publish a new script (visibility from the manifest) and write its id back.
  `node skills/greasyfork/scripts/register.mjs <file.user.js>`
- **status**: list which scripts Greasy Fork has set up to sync.

The write tools (register/set-sync/status) use a local headful browser (no API; Cloudflare requires your machine/IP) and a persisted login profile. `verify` uses only the public JSON API. See the skill's README for one-time setup.

## Use as a template

1. Fork/clone, replace the `.user.js` files with your own.
2. Edit `greasyfork.json`: one entry per script (`file`, `id` (`null` until published), `visibility`, `name`).
3. Enable the version hook and the bundled skill:
   ```sh
   git config core.hooksPath .githooks
   ln -s "$PWD/skills/greasyfork" ~/.claude/skills/greasyfork   # Claude Code global discovery
   npm install --prefix skills/greasyfork/scripts              # deps for the browser tools (verify needs none)
   ```
   pi / Codex / OpenCode auto-discover the skill via the committed `.agents/skills/greasyfork` symlink - no setup needed.
4. Publish/sync with the `greasyfork` skill. You can set up the per-user Greasy Fork webhook (Settings -> Webhooks, URL at `greasyfork.org/en/users/webhook-info`) for auto-pull, but on this repo it returns 403 (see "How publishing works"), so plan to run `set-sync` after each push regardless.

## Setup after clone

The version-bump hook lives in `.githooks/` (version-controlled). Git's hooks path is local config and is not cloned, so on a fresh clone run once:

```sh
git config core.hooksPath .githooks
```

Requires Node (the hook runs `tools/bump-version.mjs`).

## Sync troubleshooting

After a push, run `verify` (no login needed): `node skills/greasyfork/scripts/verify.mjs`. Each script shows three versions - `local` (your file), `raw` (what GitHub serves), `published` (what Greasy Fork serves):

- **`raw` behind `local`** - the push hasn't reached GitHub's raw CDN yet (~5 min), or you didn't push.
- **`published` behind `raw`** - Greasy Fork hasn't re-pulled. The webhook is dead (403, below), so auto-pull never fires; force it with `node skills/greasyfork/scripts/release.mjs` (syncs every drifted script + verifies), or `set-sync.mjs <id>` for one.

### The webhook is broken server-side (don't bother debugging it)

Diagnosed 2026-06-15: the per-user webhook endpoint `greasyfork.org/en/users/<id>/webhook` returns **403 to every POST**, and it's Greasy Fork's app doing it - not the GitHub config, not Cloudflare, not the source IP. Confirmed by:

- All GitHub deliveries 403: `gh api repos/<owner>/<repo>/hooks` (`last_response`) and `.../hooks/<id>/deliveries` (per-push codes).
- A POST from a logged-in browser session (your IP, valid Cloudflare clearance) also 403s - so it isn't GitHub's IP being blocked.
- Same 403 for JSON and form-encoded bodies, push and ping events, with and without a CSRF token.
- The 403 carries Rails headers (`X-Runtime` ~4ms, `X-Request-Id`), so the request reaches GF's app and the app rejects it. GET on the path 404s (route is POST-only, so the URL is correct).

The configured Payload URL matches exactly what `greasyfork.org/en/users/webhook-info` instructs (`application/json`, no secret), so there's nothing to re-point. Until Greasy Fork fixes their endpoint, `release` is the reliable path - it does what the webhook was supposed to.

Timing for a brand-new script: `register` builds the listing from your **local** file (works before you push), but `set-sync` points Greasy Fork at the **raw GitHub URL**, so the file must be pushed first. Order: add the `greasyfork.json` entry with `id: null` -> `register` -> `git push` -> `set-sync <id>` -> `verify`.
