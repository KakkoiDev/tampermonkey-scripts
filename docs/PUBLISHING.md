# Publishing & using as a template

This repo publishes its userscripts to [Greasy Fork](https://greasyfork.org/) and doubles as a reusable template for managing your own. Day-to-day building lives in the [README](../README.md) and [DEVELOPMENT.md](DEVELOPMENT.md); this doc covers release and reuse.

## How publishing works

There is no write API for Greasy Fork. Updates flow by Greasy Fork **pulling** the raw file from this repo:

1. Edit a `.user.js` file.
2. Commit. A `pre-commit` hook bumps `@version` to today's date (`YYYY.MM.DD`, with a `.N` suffix for same-day re-commits). Greasy Fork ignores any update whose `@version` is not incremented, so this is mandatory.
3. Push to `main`.
4. A repo webhook is supposed to ping Greasy Fork to re-fetch the raw file. In practice it does **not** work on this repo: every delivery returns **403** (verified 2026-06-15 via `gh api repos/<owner>/<repo>/hooks/<id>/deliveries` - all `push` events `403 Invalid HTTP Response`). So Greasy Fork never auto-pulls. Treat `set-sync` as a **required** release step after every push, not a fallback (see [Sync troubleshooting](#sync-troubleshooting)).

Each script is wired on its Greasy Fork **Admin -> Source Syncing** page with the raw URL `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<file>.user.js` and sync type "Automatic". `@downloadURL` / `@updateURL` are intentionally absent: Greasy Fork strips them and serves updates from its own URLs.

## Managing publishing

`greasyfork.json` maps each local file to its Greasy Fork script id and visibility. The bundled **`greasyfork` skill** (in [`skills/greasyfork/`](../skills/greasyfork/); discovered by Claude Code via `~/.claude/skills/`, and by pi/Codex/OpenCode via the repo's [`.agents/skills/`](../.agents/skills/)) drives Greasy Fork from this manifest (owner/repo/branch are derived from `git remote`, nothing hardcoded):

- **verify** (read-only, no login): check that every script's local `@version` matches the published and raw-served versions.
  `node skills/greasyfork/scripts/verify.mjs`
- **set-sync**: configure sync-from-URL + Automatic and trigger an immediate sync.
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
- **`published` behind `raw`** - Greasy Fork hasn't re-pulled. The webhook returns 403 on this repo so auto-pull never fires; don't wait it out - force it: `node skills/greasyfork/scripts/set-sync.mjs <id>` (re-points sync + triggers an immediate pull), then re-run `verify`. (Observed repeatedly: a clean push left scripts in `DRIFT` until `set-sync` was run.)
  - Check the webhook itself: `gh api repos/<owner>/<repo>/hooks` shows `last_response`; `.../hooks/<id>/deliveries` lists per-push status codes. Persistent 403 likely means Greasy Fork's Cloudflare is rejecting GitHub's server-side POST, or the per-user webhook URL is stale (re-fetch from `greasyfork.org/en/users/webhook-info`). Until fixed, `set-sync` is the reliable path.

Timing for a brand-new script: `register` builds the listing from your **local** file (works before you push), but `set-sync` points Greasy Fork at the **raw GitHub URL**, so the file must be pushed first. Order: add the `greasyfork.json` entry with `id: null` -> `register` -> `git push` -> `set-sync <id>` -> `verify`.
