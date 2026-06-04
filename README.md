# Tampermonkey scripts

Userscripts by KakkoiDev. Source of truth for the copies published on Greasy Fork.

## Scripts

| Script | What it does | Runs on | Install |
|---|---|---|---|
| [Gmeet++](gmeet-pp.user.js) | Auto-mute mic & cam on join, invert-colors button, random participant picker, and more for Google Meet | `meet.google.com` | [Greasy Fork](https://greasyfork.org/en/scripts/513815-gmeet) |
| [GitHub PR Load All Comments](github-pr-load-all-comments.user.js) | Adds a "Load all!" button that expands every hidden conversation in a GitHub PR | `github.com` | [Greasy Fork](https://greasyfork.org/en/scripts/564954) |
| [Langfinity Loby Defaults](langfinity-loby-defaults.user.js) | Turns off mic & camera in the Langfinity lobby and remembers your last-used name | `langfinity.ai/meeting` | [Greasy Fork](https://greasyfork.org/en/scripts/557742-langfinity-loby-defaults) |
| [Slack AI Translate](slack-ai-translate.user.js) | Adds an English/Japanese translation button to Slack messages and the composer | `app.slack.com` | not yet published |

## How publishing works

There is no write API for Greasy Fork. Updates flow by Greasy Fork **pulling** the raw file from this repo:

1. Edit a `.user.js` file.
2. Commit. A `pre-commit` hook bumps `@version` to today's date (`YYYY.MM.DD`, with a `.N` suffix for same-day re-commits). Greasy Fork ignores any update whose `@version` is not incremented, so this is mandatory.
3. Push to `main`.
4. A repo webhook pings Greasy Fork, which re-fetches the raw file and publishes the new version (subject to a ~5 min GitHub raw CDN cache).

Each script is wired on its Greasy Fork edit page with **Sync from URL** pointing at:

```
https://raw.githubusercontent.com/KakkoiDev/tampermonkey-scripts/main/<file>.user.js
```

`@downloadURL` / `@updateURL` are intentionally absent: Greasy Fork strips them and serves updates from its own URLs.

## Setup after clone

The version-bump hook lives in `.githooks/` (version-controlled). Git's hooks path is local config and is not cloned, so on a fresh clone run once:

```sh
git config core.hooksPath .githooks
```

Requires Node (the hook runs `tools/bump-version.mjs`).
