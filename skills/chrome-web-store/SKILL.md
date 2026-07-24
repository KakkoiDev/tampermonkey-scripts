---
name: chrome-web-store
description: Publish and update a companion Chrome extension on the Chrome Web Store from this repo. Packages the upload zip and auto-pads screenshots; the first publish (account, listing, screenshots) is done once in the Developer Dashboard; version UPDATES are then automated via the Chrome Web Store API. Use when publishing a generated extension (extensions/<name>) to the Chrome Web Store, packaging its zip, sizing its screenshots, pushing a new version, or wiring the API credentials. Triggers - "publish to chrome web store", "package the extension", "update the extension on the web store", "cws publish", "release the chrome extension", "chrome web store".
license: MIT. See LICENSE.txt
metadata:
  author: cyril.antoni
  version: "1.0"
---

# chrome-web-store

Publish and keep a companion Chrome extension updated on the Chrome Web Store. Extensions here are generated from userscripts (see [docs/EXTENSIONS.md](../../docs/EXTENSIONS.md)); this skill ships them. Detailed human walkthrough + paste-ready listing copy: [docs/CHROME-WEB-STORE.md](../../docs/CHROME-WEB-STORE.md).

## The model (read first)

- **The first publish is dashboard-only.** The Chrome Web Store API can upload a package and publish it, but it **cannot** create the listing or set the store metadata a first submission requires - description, screenshots, category, privacy policy. So the very first release of an item is done by hand in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), which also mints the item's **ID**.
- **Version updates are API-automatable.** Once the item exists and its listing is filled, `scripts/cws-publish.mjs` uploads a new zip to that item and publishes it, no dashboard. Listing changes (new screenshots, new copy) still go through the dashboard.
- **The version must increase every update.** The repo's pre-commit hook bumps the extension manifest `version` from the userscript `@version`, so a committed change is enough.

## Prerequisites

- A registered CWS developer account (one-time US$5). If Google Payments errors on desktop (`OR_*`), retry with browser extensions off / in incognito, or on a phone.
- The extension prepped - icons, manifest, privacy policy. See [docs/CHROME-WEB-STORE.md](../../docs/CHROME-WEB-STORE.md) (icons come from `tools/make-icons.mjs`).
- For API updates only: OAuth credentials (Step 4) + a one-time `npm install` in this skill's `scripts/`.

## Step 1 - package the upload zip

```sh
node skills/chrome-web-store/scripts/make-zip.mjs extensions/<name>
```

Derives the runtime files from the manifest (manifest.json + the JS/CSS/icons/rules it references) and zips them, excluding `source.json`, `README`, `icon.svg`, screenshots, `.gitignore`, and `_metadata`. Writes `extensions/<name>-cws.zip` (gitignored). Override with `--out=<path>`. It prints the archive contents - confirm no dev files slipped in.

## Step 2 - size the screenshots (auto-pad + warn)

CWS screenshots must be **exactly 1280x800 or 640x400**. Auto-pad an off-size shot:

```sh
node skills/chrome-web-store/scripts/pad-screenshot.mjs shot.png            # -> shot-1280x800.png
node skills/chrome-web-store/scripts/pad-screenshot.mjs shot.png --size=640x400 --bg=252525
```

macOS (uses `sips`). It letterboxes on `--bg` and prints a **WARNING** when the source was not the target ratio (you'll get bars top/bottom or left/right). For a full-bleed image, capture at the target size directly. You still upload screenshots by hand in the dashboard - the API can't.

## Step 3 - first publish (dashboard, once per extension)

The API can't create a listing, so the first release is manual:

1. In the [Developer Dashboard](https://chrome.google.com/webstore/devconsole): **Items -> Add new item -> Upload** the zip from Step 1. This creates the item and its **ID** (in the URL - save it).
2. **Store listing:** product name, Summary (<=132) and Description, Category, Language, and upload the padded screenshots. Copy for the name/summary/description is in [docs/CHROME-WEB-STORE.md](../../docs/CHROME-WEB-STORE.md)'s appendix.
3. **Privacy tab:** single-purpose statement + permission justification (both in the appendix), the data-usage declaration (this repo's extensions collect/transmit nothing), and the **privacy-policy URL** (the extension's `PRIVACY.md` GitHub URL - it must be **pushed and live**, or review fails on a dead link).
4. **Visibility:** Unlisted (shareable link) for a team tool, or Public. **Submit for review.**
5. Save the item ID for Step 5.

## Step 4 - API credentials (once)

Four secrets; keep them out of git:

1. [Google Cloud Console](https://console.cloud.google.com): create/pick a project and **enable the "Chrome Web Store API."**
2. Create an **OAuth 2.0 Client ID**, application type **Desktop**. Note the **client ID** and **client secret**.
3. Get a **refresh token** for scope `https://www.googleapis.com/auth/chromewebstore` (OAuth Playground with your own client, or a one-off consent script).
4. Export all four (shell profile or a local, gitignored env file):
   ```sh
   export CWS_EXTENSION_ID=...   # the item ID from Step 3
   export CWS_CLIENT_ID=...
   export CWS_CLIENT_SECRET=...
   export CWS_REFRESH_TOKEN=...
   ```

## Step 5 - publish updates (API)

```sh
npm install   # one-time, in skills/chrome-web-store/scripts
node skills/chrome-web-store/scripts/cws-publish.mjs extensions/<name>-cws.zip
```

Re-package (Step 1) first so the zip has the bumped version. Flags:
- `--upload-only` - upload a draft without publishing (review in the dashboard, then re-run without it). **Use this on the first API run.**
- `--target=trustedTesters` - publish to your testers group instead of the public.

It uploads the package to `CWS_EXTENSION_ID` and publishes, printing the upload state and publish status.

## Cautions

- The API updates the **package** only. New screenshots or changed copy still go through the dashboard.
- Publishing can go to **review**; it isn't instantly live. Rejections arrive by email + in the dashboard.
- `uploadState: FAILURE` means wrong item ID, bad zip, or the version didn't increase.
- `cws-publish.mjs` is untested against a live account (no credentials in-repo) - first real run, use `--upload-only`.

## Portability

Self-contained under `skills/chrome-web-store/`. `make-zip.mjs` and `pad-screenshot.mjs` need only Node + macOS `sips`; `cws-publish.mjs` needs `chrome-webstore-upload` (`npm install` in `scripts/`).
