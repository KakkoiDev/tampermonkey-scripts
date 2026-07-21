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

## What's done

Registered (user scope, all projects), via the confirmed-working `npm exec` form
(`npx` is aliased to `npm run` in this shell and mis-parses):

```
claude mcp add chrome-devtools --scope user -- npm exec -y -- chrome-devtools-mcp@latest --autoConnect
```

`--autoConnect` (Chrome 144+; this machine is 150) attaches to the **real stable-channel
Chrome profile** - i.e. the human's logged-in Google/Meet session - instead of a fresh
dedicated profile. Rollback: `claude mcp remove chrome-devtools -s user`.

## Remaining one-time steps (human)

1. In Chrome, open `chrome://inspect/#remote-debugging` and **start/enable the remote
   debugging server**. `--autoConnect` needs this toggle; without it the MCP server runs
   but never attaches to a tab. Leave Chrome running.
2. **Restart Claude Code** (quit + relaunch). MCP tools load at session start, so the
   `chrome-devtools` tools are not available in the session that registered the server.
3. Verify next session: `claude mcp get chrome-devtools` shows Connected, and the agent
   can call a list-pages / navigate tool.

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

- **Security:** autoConnect drives the human's actual logged-in Chrome - the agent can act
  on any open tab (mail, etc.). Keep only the tab under test open during a debug session, or
  accept the exposure knowingly. This is why it's not on by default in normal work.
- **Fragility:** Google DOM churn, OOPIF, automation detection. Keep anchoring on stable
  attributes (`jsname`, `data-*`, `role`).
- **Not a human-repro replacement** per the Fix Protocol - it's a faster second confirmation.
- Puppeteer is already vendored (`skills/greasyfork/scripts/node_modules`) and can drive a
  browser too; the MCP is the ergonomic option because the agent calls it as tools.

## Fold-in (later)

Once validated on the two bugs above, add a short "Debugging on a logged-in site (MCP)"
subsection to `docs/DEVELOPMENT.md` pointing here. Commit this doc on its own, separate from
the `feat/gmeet-pp-native-toolbar` branch.
