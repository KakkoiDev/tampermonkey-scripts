# greasyfork skill

Publish and keep userscripts in sync on Greasy Fork (greasyfork.org) from a git repo. Greasy Fork has no write API, so reads use its public JSON API and writes drive a local browser (Cloudflare requires the user's own machine/IP).

## One-time setup
1. Install Puppeteer for the browser tools (Chromium downloads once into `~/.cache/puppeteer`):
   ```sh
   npm install --prefix ~/.claude/skills/greasyfork/scripts
   ```
2. The first browser command opens a visible window on Greasy Fork's sign-in page. Log in once (any method). The session persists to `~/.cache/greasyfork/profile`; later runs reuse it. Your login tab is never reloaded.

`verify` needs neither step - it uses only the public API and Node's built-in `fetch`.

## Use
Run from the root of a repo that contains a `greasyfork.json` ([schema](references/manifest.md)):

| Task | Command |
|---|---|
| Check sync (read-only) | `node ~/.claude/skills/greasyfork/scripts/verify.mjs` |
| Configure/refresh sync | `node ~/.claude/skills/greasyfork/scripts/set-sync.mjs [id\|file\|all]` |
| Publish a new script | `node ~/.claude/skills/greasyfork/scripts/register.mjs <file.user.js>` |
| List what's syncing | `node ~/.claude/skills/greasyfork/scripts/status.mjs` |

## Troubleshooting
- **DRIFT in verify** - `@version` wasn't bumped, the GitHub raw CDN is lagging (~5 min), or the webhook didn't deliver (repo Settings -> Webhooks -> Recent Deliveries).
- **Stuck at login** - delete `~/.cache/greasyfork/profile` and re-run to start a clean login.
- **Browser tool breaks after a Greasy Fork redesign** - the DOM selectors are centralized in `scripts/*.mjs` and documented in [references/greasyfork-model.md](references/greasyfork-model.md). `verify` (public API) keeps working regardless.

See [SKILL.md](SKILL.md) for the full model and recipes.
