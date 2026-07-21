# chrome-devtools-mcp: dev/test integration (as-built)

## Why

Userscripts here target auth-gated, hashed-DOM sites (Meet, Slack, Notion, GitHub).
Debugging them was a manual loop: add `DEBUG` logs, ask the human to reload, have them
paste console/`outerHTML`, repeat. `chrome-devtools-mcp` lets the agent drive the human's
real, logged-in Chrome over CDP - reload, read live DOM (`data-is-muted`, `aria-expanded`),
read console (incl. cross-frame), screenshot, click - collapsing the loop to one pass.

**Scope boundary:** dev/test only. It does NOT change what a shipped userscript can do
(end users have no MCP). It replaces our instrumentation, not runtime capability.

**Worth it for:** the auth-gated / hashed-DOM scripts. Overkill for simple public pages.
Only relevant when a live-site bug needs eyes the human would otherwise paste by hand.

## What's done (tested)

Registered (user scope, all projects), attaching to a dedicated debug-port Chrome via
`--browserUrl`. The `npm exec` form is used because `npx` is aliased to `npm run` in this
shell and mis-parses:

```
claude mcp add chrome-devtools --scope user -- npm exec -y -- chrome-devtools-mcp@latest --browserUrl=http://127.0.0.1:9222
```

Rollback: `claude mcp remove chrome-devtools -s user`.

**What did NOT work:** `--autoConnect` (meant to attach to the real logged-in profile via
`chrome://inspect/#remote-debugging`). On Chrome 150 it failed with "Could not find
DevToolsActivePort" - the toggle's server on `:9222` does not serve the classic CDP HTTP
endpoints (`/json/version`, `/json/list` all 404), so neither `--autoConnect` nor
`--browserUrl` can talk to it. The dedicated-port method below is what actually attached.

## Setup (human, one-time)

1. Launch a **dedicated** Chrome with remote debugging - Chrome refuses
   `--remote-debugging-port` on the default profile, so a separate `--user-data-dir` is
   required:
   ```
   open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-cdp-profile" --use-fake-device-for-media-stream --use-fake-ui-for-media-stream
   ```
   The fake-device flags matter for Meet: with **no** mic/cam in the profile the mute
   toggles are no-ops (`data-is-muted` never changes, verified), so auto-mute can't be
   exercised. Granting real mic/cam in the profile works too.
2. Sign into Google in that window once (fresh profile; persists at `~/.chrome-cdp-profile`).
3. **Restart Claude Code** with that Chrome already running - the `--browserUrl` server
   attaches at session start. Verify: `claude mcp get chrome-devtools` Connected, then
   `list_pages` returns the tab.

The dedicated profile has no Tampermonkey, so the agent **injects the userscript over CDP**
(`navigate_page` initScript / `evaluate_script`) rather than relying on a dev loader.
Install Tampermonkey in the profile once if you prefer the real dev-loader path.

## Usage loop (once tools are live)

- Keep the in-file `DEBUG` block; the MCP reads its console output directly (including the
  `chat.google.com` frame - CDP sees all frames, so no manual "switch console context").
- Debug pass: navigate/reload the Meet URL, `evaluate_script` to read state, read console,
  screenshot. No human paste.
- Fits Fix Protocol step 3 (independent confirmation): the MCP-driven reload + state read +
  screenshot IS the automated check; capture it as evidence. Still not a replacement for the
  human end-to-end double-check (step 7).
- UI placement rule (CLAUDE.md): take the pre-commit placement screenshot via the MCP.

## First target: the two open gmeet-pp bugs

1. **Auto-mute intermittent on reload** (was 50%, then still failing): reload the green room
   ~10x; after each, `evaluate_script` to read `data-is-muted` on `button[jsname="hw0c9"]`
   (mic) + `button[jsname="psRWwc"]` (cam); assert both reach `"true"` within ~2s; dump the
   `[Gmeet++] mic/cam ...` logs.
2. **Cold-open chat send fails** (chat closed on first click -> opens but doesn't post):
   with `DEBUG=true`, trigger a chat action, read the `chat.google.com` frame console for
   `chat-frame agent ready` / `composer never appeared` / `text did not land` /
   `dispatched Enter (send btn disabled=...)`, and inspect the composer + send button state
   in-frame. This is the bug that motivated the integration.

## Caveats

- **Security:** the debug port gives the agent full control of that Chrome instance. The
  dedicated profile limits exposure to whatever you sign into there - keep it separate from
  your main browsing, and only sign into the account you're testing with.
- **Fragility:** Google DOM churn, OOPIF, automation detection. Keep anchoring on stable
  attributes (`jsname`, `data-*`, `role`).
- **Not a human-repro replacement** per the Fix Protocol - it's a faster second confirmation.
- Puppeteer is already vendored (`skills/greasyfork/scripts/node_modules`) and can drive a
  browser too; the MCP is the ergonomic option because the agent calls it as tools.

## Fold-in (later)

Once validated on the two bugs above, add a short "Debugging on a logged-in site (MCP)"
subsection to `docs/DEVELOPMENT.md` pointing here. Commit this doc on its own, separate from
the `feat/gmeet-pp-native-toolbar` branch.
