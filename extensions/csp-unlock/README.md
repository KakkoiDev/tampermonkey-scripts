# CSP Unlock (P2P devtool)

Companion browser extension for the `GM_trystero` userscript (`scripts/gm-trystero.user.js`).

## What it does

A userscript cannot modify response headers, and a page's Content-Security-Policy is locked in the moment the page loads. So on strict-CSP sites (Notion, GitHub, Google) trystero's `import()` and its signaling WebSocket are blocked and there is no in-page way to relax it.

This extension does the one thing the userscript can't: it removes the `Content-Security-Policy` response header - **but only on page loads whose URL carries `__nocsp=1`**. It uses a single `declarativeNetRequest` rule (`rules.json`), no background script.

That flag is what `GM_trystero.load({ disableCSP: true })` adds before reloading. So CSP is stripped only for loads you explicitly trigger, not for normal browsing.

## Install (Chrome/Edge, unpacked)

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`extensions/csp-unlock`).
4. Confirm it's enabled. (Firefox: `about:debugging` -> This Firefox -> Load Temporary Add-on -> pick `manifest.json`.)

## Use

On a strict-CSP site, in the console:

```js
await GM_trystero.load({ disableCSP: true })
```

The page reloads once with `__nocsp=1`, this extension strips the CSP header on that load, the userscript auto-resumes `load()` and removes the flag from the URL. Then use the trystero API normally (`GM_trystero.joinRoom(...)`, etc.).

## Security tradeoff (read this)

- `host_permissions` is `<all_urls>` so the flag works on any site, but the rule **only fires when `__nocsp=1` is in the URL**. Normal loads are untouched. To narrow it, replace `<all_urls>` with a specific list (e.g. `"https://app.notion.com/*"`).
- On a flagged load, that page has **no CSP** - its XSS protections are off for that visit. Only do this on sites you trust and are logged into knowingly.
- The flag is guessable: any load of `site/?__nocsp=1` strips CSP for that visit. A malicious link could exploit that. Acceptable for a personal devtool; do not ship this to non-developers.
- Removes header-based CSP only. Sites that also set CSP via a `<meta>` tag are not fully unlocked by this.
