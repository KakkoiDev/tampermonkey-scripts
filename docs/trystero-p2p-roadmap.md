# Trystero P2P Playground - roadmap (v2 and beyond)

Script: `scripts/trystero-p2p.user.js`. v1 is a console-driven WebRTC P2P playground (trystero/Nostr) with origin-independent identity and a generic action layer, meant as a base for real-time apps. This file tracks everything deliberately deferred past v1, plus the dead ends so we do not re-debug them.

## Shipped in v1 (for reference, not v2)
- Runtime `import()` of trystero from esm.sh (zero build).
- Nostr signaling backend.
- Origin-independent id + room via `GM_setValue`/`GM_getValue`.
- Console API on `window.p2p` (identity, room, messaging, generic `on`/`emit`, presence, meta).
- `openTab(url?)` - jump to a permissive page in a new tab.

## v2 candidates

### 1. Vendored `@require` bundle of trystero
- **What:** Bundle trystero into a single classic IIFE that assigns a global, with `esbuild --bundle --format=iife --global-name=Trystero <entry>.js`. Commit the output under `vendor/`, `@require` it instead of runtime `import()`.
- **Why:** (a) sidesteps runtime `import()` entirely, which matters if `import()` turns out broken in the Tampermonkey sandbox on the target setup; (b) removes the runtime dependency on esm.sh (a third-party CDN that can rate-limit or go down); (c) `@require` bypasses page `script-src` for loading the lib.
- **Does NOT fix:** the signaling `wss` (`connect-src`). trystero still opens WebSockets to Nostr relays from page context, so strict-CSP sites still will not connect. Only the CSP toggle or a permissive origin fixes connectivity.
- **Trigger:** build this only if `import()` proves broken in the sandbox during v1 testing, or to drop the esm.sh dependency. Not worth it purely for CSP.
- **Hosting:** serve via `https://cdn.jsdelivr.net/gh/<user>/<repo>@<tag>/vendor/trystero.iife.js`, NOT `raw.githubusercontent.com`. gh raw is not on Greasy Fork's `@require` allowlist (would block a future publish) and is caching-laggy. jsDelivr-from-gh is a real CDN, git-tag-versioned, and allowlisted.
- **Dev vs share:** keep `file://` `@require` for live-reload dev (gh/jsDelivr `@require` content is cached by Tampermonkey and will not reflect local edits instantly).

### 2. Room password / encryption
- **What:** expose trystero's `password` config on `joinRoom({ appId, password }, roomId)` (AES-GCM on session descriptions).
- **Why:** appId + room is a public namespace today. Anyone running the script with the same room id worldwide connects. A password (or a non-obvious room id) gives real privacy.

### 3. On-page UI
- **What:** optional minimal UI (a floating panel: id, room, member list, message log/input) instead of console-only.
- **Why:** discoverability and usability past the console-driven prototype phase. Keep it opt-in so the script stays quiet on every page.

### 4. Greasy Fork registration
- **What:** add the entry to `greasyfork.json` (+ README row via `tools/gen-readme.mjs`) and publish.
- **Why:** distribution. Deferred until the script is worth publishing. Note: publishing requires no external `@require` from disallowed hosts (see item 1 hosting note).

### 5. Signaling backend as config
- **What:** allow swapping Nostr for torrent/mqtt/ws-relay via a setting; today it is hardcoded to the default (Nostr).
- **Why:** relay reliability varies; some deployments may want a specific/self-hosted backend. Also affects which hosts `connect-src` must allow.

### 6. Signaling diagnostics for Nostr
- **What:** `relays()` currently returns `{}` on the default Nostr entry because `getRelaySockets` is only exported by some strategy packages, not the default `trystero` entry. Improve the signaling diagnostic (e.g. import from the strategy subpath that exports it, or track connection state ourselves).
- **Why:** `relays()` is meant to distinguish "relay flakiness" from "our bug" during testing; empty output weakens that.

### 7. Robustness / app-layer niceties
- Stale-peer cleanup / presence heartbeat (detect peers that dropped without a clean leave).
- Optional message history buffer.
- Example apps built on the generic `on`/`emit` layer (shared cursors, live reactions, a shared counter) as documentation.

## Rejected / will not fix (do not re-litigate)

### "Open an empty tab to escape CSP"
Does not work. Documented so we stop revisiting it:
- `data:` tab: Chrome blocks top-level navigation to `data:` URLs ("Not allowed to navigate top frame to data URL").
- `blob:` tab: a `blob:` document inherits the CSP of the origin that created it. Spawned from a strict page, it carries that strict CSP.
- `about:blank`: Tampermonkey does not inject there (`@match *://*/*` does not cover the `about:` scheme), and pushing code in from a strict opener is browser-dependent and awkward.
- The only real escape is landing on a real http(s) origin that itself ships no/loose CSP (that is what `openTab()` targets), or enabling Tampermonkey's "Modify existing CSP headers" setting.

### "`@require` from gh raw to bypass CSP"
Misconception. `@require` bypasses page CSP only for *loading the required file's code*. The runtime `import()` and the signaling `wss` still run in page context under page CSP. `@require`-ing our script (or a bundled trystero) does not make P2P connect on strict sites. gh raw is a valid distribution source for the code, but see item 1 for why jsDelivr-from-gh is preferred over raw.

## The one hard limit (any version)
The signaling WebSocket (`wss` to relays) is governed by the page's `connect-src`, and no userscript-level mechanism bypasses it (GM_xmlhttpRequest is HTTP-only, not WebSocket). On strict-CSP sites, peers connect only if the user enables Tampermonkey's "Modify existing CSP headers" setting (a global toggle and a real security downgrade) or runs on a permissive origin. "Runs on every page" means the script and console helpers load wherever injection is allowed; peers connect on the subset of sites where the signaling `wss` is permitted.
