# Publishing a companion extension to the Chrome Web Store

How to register a Chrome Web Store (CWS) developer account and publish a generated extension from this repo. Worked example: `extensions/notion-comment-recovery`.

Unpacked/dev-mode is fine for testing, but colleagues can't use it. The Web Store gives a real one-click install with auto-update. Firefox/Edge and the tradeoffs are in [EXTENSIONS.md](EXTENSIONS.md); this guide is Chrome-only.

## 1. Register the developer account (one-time)

1. Go to the **[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)** and sign in with the Google account you want to own the listings (a work/team account is better than a personal one - the listings belong to whoever owns it).
2. Accept the developer agreement and pay the **one-time US$5 registration fee**.
3. Set your **publisher details** (a display name; verify the contact email). You can publish under a personal name or set up a group publisher later.

That's the whole account setup. It's paid once, not per extension.

## 2. Project setup (per extension)

Everything below is already done for `notion-comment-recovery` - this section is the checklist for it and for the next one.

### a. Icons
CWS requires a 128px icon; the manifest also references 16/32/48. They're generated from an SVG:

```sh
node tools/make-icons.mjs extensions/notion-comment-recovery/icon.svg extensions/notion-comment-recovery/icons
```

The manifest declares them under `"icons"`. To change the art, edit `icon.svg` and re-run.

### b. Manifest
Already valid for CWS: `manifest_version: 3`, `name`, `version` (auto-synced from the userscript `@version`), `description` (<= 132 chars), `icons`, `minimum_chrome_version`, and the `content_scripts` block. `notion-comment-recovery` declares **no permissions and no `host_permissions`** (it runs in `world: MAIN` and only makes same-origin Notion fetches), which keeps review light.

### c. Privacy policy (required)
CWS requires a privacy policy URL for anything that touches user data. This repo hosts one per extension: `extensions/notion-comment-recovery/PRIVACY.md`. Use its GitHub URL in the listing:

```
https://github.com/KakkoiDev/tampermonkey-scripts/blob/main/extensions/notion-comment-recovery/PRIVACY.md
```

### d. Screenshots (you must capture these)
The one thing that can't be generated - CWS needs at least one **1280x800** or **640x400** screenshot (up to 5). On a real logged-in Notion page with comments:
1. Open the panel (the "N comments" badge, top-right) and screenshot it showing a few threads.
2. A second showing a **deleted-block** thread (red pill) and the Restore/Re-attach buttons is worth including - it's the headline feature.
Crop/pad to exactly 1280x800 or 640x400.

### e. Build the upload zip
CWS wants a `.zip` of the extension's **runtime files only** (not `source.json`, `README`, `icon.svg`, `.gitignore`, or `_metadata/`):

```sh
cd extensions/notion-comment-recovery
zip -r ../notion-comment-recovery-cws.zip manifest.json notion-comment-recovery.js icons
cd -
```

## 3. Create the listing and submit

In the Developer Dashboard: **Items -> Add new item -> upload the zip**. Then fill in:

**Store listing**
- **Product name:** Notion Comment Recovery
- **Summary** (<= 132): paste from the appendix.
- **Description:** paste from the appendix.
- **Category:** Productivity
- **Language:** English
- **Store icon:** taken from the 128px icon in the zip; upload `icons/icon-128.png` if asked.
- **Screenshots:** upload yours from step 2d.

**Privacy tab**
- **Single purpose:** paste from the appendix.
- **Permission justification:** paste from the appendix (host access to Notion only).
- **Data usage:** declare that the extension does **not** collect or transmit user data (it doesn't - all local + same-origin Notion). Check the "not being sold to third parties" and "not used for unrelated purposes" boxes.
- **Privacy policy URL:** the GitHub URL from step 2c.

**Distribution**
- **Visibility:** **Unlisted** shares by direct link without appearing in search (matches how the userscripts are published here, good for a team tool). **Public** if you want it discoverable. Either is one-click install.
- Submit for review. Review is usually hours-to-days; broad host permissions would slow it, but this one has none.

## 4. Publishing updates

The version must increase on every update, and it's automatic here: edit the source `scripts/notion-comment-recovery.user.js`, commit (the pre-commit hook bumps the `@version` and regenerates the extension `.js` + manifest `version`), push, then re-zip (step 2e) and upload the new zip in the dashboard -> submit. Same listing, new version.

Later, this can be automated end to end: CWS has a publish API (`chrome-webstore-upload` / the Web Store API), so a skill could push updates the way the `greasyfork` skill does for userscripts - no dashboard clicking. Not built yet.

## Appendix - paste-ready listing copy

**Summary (<= 132 chars)**
```
See every comment Notion stores for a page - open, resolved, and on deleted blocks or removed anchors - in one panel, with export and restore.
```

**Description**
```
Notion Comment Recovery surfaces every comment Notion still stores for the page you're on - not just the ones visible inline.

It shows, in one floating panel:
- Open and resolved comments.
- Comments whose anchor text was removed ("orphaned").
- Comments on blocks that were deleted - which Notion hides, but still keeps.

It also deep-scans the page's version history to recover comments on blocks deleted long ago, and passively captures comments as you browse so they survive even after deletion.

What you can do:
- Filter by all / deleted / resolved / open.
- Export the page's comments to a Markdown file.
- Restore a deleted block so its comment reappears inline, or re-attach an orphaned comment to its block - one click, with a confirm.
- See an estimated countdown before a trashed block is permanently purged.

Privacy: everything runs locally in your browser. It reads only your own Notion data through Notion's API using your existing session, and sends nothing to any other server. No tracking, no analytics.

Honest limit: it can only recover comments that were snapshotted by Notion's version history or seen live while the extension was running. A comment created and deleted before it was ever captured can't be recovered - nothing references it.
```

**Single purpose**
```
Surface and recover the comments Notion stores for the current page - including comments whose block or anchor was deleted - in one panel, with export to Markdown and one-click restore.
```

**Permission justification** (host access to `notion.so` / `notion.com`)
```
The extension runs only on Notion pages and reads the page's own comment and discussion data through Notion's same-origin API, using your existing logged-in Notion session. This host access is required to list, export, and restore the page's comments. No other permissions are requested and no data is sent anywhere other than Notion.
```
