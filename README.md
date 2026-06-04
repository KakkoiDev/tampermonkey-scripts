# Tampermonkey scripts

Userscripts by KakkoiDev, version-controlled here and published on Greasy Fork. The repo doubles as a reusable template for managing your own userscripts (see [Use as a template](#use-as-a-template)).

## Scripts

| Script | What it does | Runs on | Install |
|---|---|---|---|
| [Gmeet++](gmeet-pp.user.js) | Auto-mute mic & cam on join, invert-colors button, random participant picker, and more for Google Meet | `meet.google.com` | [Greasy Fork](https://greasyfork.org/en/scripts/513815-gmeet) |
| [GitHub PR Load All Comments](github-pr-load-all-comments.user.js) | Adds a "Load all!" button that expands every hidden conversation in a GitHub PR | `github.com` | [Greasy Fork](https://greasyfork.org/en/scripts/564954) |
| [Langfinity Loby Defaults](langfinity-loby-defaults.user.js) | Turns off mic & camera in the Langfinity lobby and remembers your last-used name | `langfinity.ai/meeting` | [Greasy Fork](https://greasyfork.org/en/scripts/557742-langfinity-loby-defaults) |
| [Slack AI Translate](slack-ai-translate.user.js) | Adds an English/Japanese translation button to Slack messages and the composer | `app.slack.com` | [Greasy Fork](https://greasyfork.org/en/scripts/581056-slack-ai-translate) (unlisted - direct link only) |

## How publishing works

There is no write API for Greasy Fork. Updates flow by Greasy Fork **pulling** the raw file from this repo:

1. Edit a `.user.js` file.
2. Commit. A `pre-commit` hook bumps `@version` to today's date (`YYYY.MM.DD`, with a `.N` suffix for same-day re-commits). Greasy Fork ignores any update whose `@version` is not incremented, so this is mandatory.
3. Push to `main`.
4. A repo webhook pings Greasy Fork, which re-fetches the raw file and publishes the new version (subject to a ~5 min GitHub raw CDN cache).

Each script is wired on its Greasy Fork **Admin -> Source Syncing** page with the raw URL `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<file>.user.js` and sync type "Automatic". `@downloadURL` / `@updateURL` are intentionally absent: Greasy Fork strips them and serves updates from its own URLs.

## Managing publishing

`greasyfork.json` maps each local file to its Greasy Fork script id and visibility. The companion **`greasyfork` Claude skill** drives Greasy Fork from this manifest (owner/repo/branch are derived from `git remote`, nothing hardcoded):

- **verify** (read-only, no login): check that every script's local `@version` matches the published and raw-served versions.
  `node ~/.claude/skills/greasyfork/scripts/verify.mjs`
- **set-sync**: configure sync-from-URL + Automatic and trigger an immediate sync.
  `node ~/.claude/skills/greasyfork/scripts/set-sync.mjs [id|file|all]`
- **register**: publish a new script (visibility from the manifest) and write its id back.
  `node ~/.claude/skills/greasyfork/scripts/register.mjs <file.user.js>`
- **status**: list which scripts Greasy Fork has set up to sync.

The write tools (register/set-sync/status) use a local headful browser (no API; Cloudflare requires your machine/IP) and a persisted login profile. `verify` uses only the public JSON API. See the skill's README for one-time setup.

## Use as a template

1. Fork/clone, replace the `.user.js` files with your own.
2. Edit `greasyfork.json`: one entry per script (`file`, `id` (`null` until published), `visibility`, `name`).
3. `git config core.hooksPath .githooks` (see below), then publish/sync with the `greasyfork` skill.
4. Set up the per-user Greasy Fork webhook on your repo (Settings -> Webhooks) using the URL shown at `greasyfork.org/en/users/webhook-info`.

## Setup after clone

The version-bump hook lives in `.githooks/` (version-controlled). Git's hooks path is local config and is not cloned, so on a fresh clone run once:

```sh
git config core.hooksPath .githooks
```

Requires Node (the hook runs `tools/bump-version.mjs`).
