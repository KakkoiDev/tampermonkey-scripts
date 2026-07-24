# Chrome Web Store listing - Notion Comment Recovery

Canonical, paste-ready copy for the Developer Dashboard listing. Written to CWS limits (summary <= 132 chars, description <= 16000).

- **Product name:** Notion Comment Recovery
- **Category:** Workflow & Planning (`CATEGORY_WORKFLOW_AND_PLANNING`)
- **Language:** English
- **Store icon:** `store-icon-128.png` (128x128; 96x96 artwork + 16px transparent padding per CWS guidelines). Do NOT use the manifest's `icons/icon-128.png` here - those are full-bleed for the toolbar.
- **Visibility:** Unlisted (shareable by direct link, not shown in search) - or Public to make it discoverable.
- **Privacy policy URL:** https://github.com/KakkoiDev/tampermonkey-scripts/blob/main/extensions/notion-comment-recovery/PRIVACY.md
- **Data usage:** does not collect or transmit user data (all local + same-origin Notion). Tick "not sold to third parties" and "not used for unrelated purposes," then check the compliance certification box.
- **Remote code:** No - all executable code ships in the package; the extension only fetches Notion data (not code) and uses no eval or remote scripts.
- **Contact email:** set and verify a publisher contact email on the dashboard Settings page (publishing is blocked until it is verified).

## Summary (<= 132 chars)

```
See every comment Notion stores for a page - open, resolved, and on deleted blocks or removed anchors - in one panel, with export and restore.
```

## Description (<= 16000 chars)

```
Notion Comment Recovery shows you every comment Notion still stores for the page you're on - not just the ones you can see. Comments don't always disappear when they look gone: delete the block a comment is on, or remove the text it was anchored to, and Notion hides the comment while quietly keeping the record. This extension surfaces all of it in one panel, lets you export it, and can bring deleted comments back.

WHAT IT SHOWS

Open the "comments" badge in the top-right of any Notion page to see, in one place:
- Open comments and their replies.
- Resolved comments.
- Orphaned comments - ones whose anchor text was edited away, so Notion stopped showing them inline.
- Deleted-block comments - comments on blocks that were deleted. Notion hides these but keeps the records; the panel brings them back into view.
- Deleted comments - comments that were removed entirely, recovered from a local cache if they were seen while you browsed.

Filter the list by All / Deleted / Resolved / Open, and read a per-thread status pill so you always know what state each comment is in.

WHAT YOU CAN DO

- Export the page's comments to a Markdown file - a clean, dated archive with author names, timestamps, block titles, and anchor text.
- Copy any single thread to the clipboard.
- Jump to a live comment ("Go") to scroll straight to it on the page.
- Restore a deleted block, so its comment reappears inline - put back in its original position when that can be recovered from history.
- Re-attach an orphaned comment to its block, so it shows up again as a block-level comment.
- See a purge countdown on deleted blocks - an estimate of how many days remain before Notion permanently removes a trashed block, so you can rescue a comment before it's gone for good.

Restore and re-attach write to your workspace, so they're always behind a confirmation.

HOW IT FINDS COMMENTS

It pulls from four sources, all through Notion's own API using your existing login - no token, no setup:
- The live page tree - every open and resolved comment.
- The page's orphaned-discussion records - anchor-removed comments.
- Version history - a deep scan of past snapshots recovers comments on blocks deleted long ago.
- A passive cache - while you browse, it records the comments Notion loads, so a comment survives in the archive even after its block, or the comment itself, is deleted. This is the only way to catch deletions that happen before a version snapshot exists.

Every comment is then categorized by the current state of its block, and comments that belong to other pages (backlinks, mentions, your inbox) are filtered out.

PRIVACY

Everything runs locally in your browser. The extension reads only your own Notion data, through Notion's API, using your existing session - and sends nothing to any other server. There is no analytics, no tracking, no telemetry, and it asks for no special browser permissions; it runs only on Notion pages. The small local cache it keeps to recover deleted comments never leaves your browser and is cleared when you clear the site's data.

HONEST LIMIT

It can only recover comments that Notion snapshotted in version history, or that were seen live while the extension was running. A comment that was created and then deleted before it was ever captured - no snapshot, never browsed with the extension active - can't be recovered, because nothing references it anymore. This is a real limit of what's retrievable, not a bug.

WHO IT'S FOR

Anyone who relies on Notion comments for decisions, feedback, or records and has been burned by one vanishing when a block was deleted or edited. If you've ever thought "there was a comment here and now it's gone," this is for you.
```

## Single purpose

```
Surface and recover the comments Notion stores for the current page - including comments whose block or anchor was deleted - in one panel, with export to Markdown and one-click restore.
```

## Permission justification (host access to notion.so / notion.com)

```
The extension runs only on Notion pages and reads the page's own comment and discussion data through Notion's same-origin API, using your existing logged-in Notion session. This host access is required to list, export, and restore the page's comments. No other permissions are requested and no data is sent anywhere other than Notion.
```
