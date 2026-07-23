# Script Idea: Notion Orphaned Comment Inspector

## What it does

A Tampermonkey userscript that runs on `www.notion.so` and detects inline comments whose parent block has been deleted (trashed). It surfaces these "orphaned" comments before the 30-day Trash window expires and they're permanently deleted.

## Why

Notion deletes inline comments transactionally with their parent block. But there's a 30-day soft-delete window (Trash) where both still exist. The Notion UI doesn't expose a way to see "all comments on trashed blocks" — they disappear from view the moment the block is deleted. This script recovers that visibility so you can:

- Find comment threads you lost when deleting a block by accident
- Export comments from trashed blocks before the 30-day purge
- Audit a page for "ghost" discussions that reference now-gone blocks

## How it works

### Architecture

The script hooks into Notion's **internal API** (the same XHR/fetch calls the Notion web app uses), NOT the public REST API (which requires an integration token and can't see resolved comments or comments on trashed blocks).

### Detection strategy

1. **Hook Notion's internal fetch/XHR**: Intercept API responses that list comments for a page. Notion's web app loads comments via internal endpoints like `https://www.notion.so/api/v3/getComments` or similar. Catch these responses to see all comment data the page loads, including the `block_id` each comment is attached to.

2. **Cross-reference block existence**: For each comment found, check if its parent block is still visible on the page. Use Notion's internal `api/v3/getBlockRoles` or `api/v3/loadPageChunk` to verify the block's status. If the block returns `in_trash: true` or returns a 404, flag the comment as orphaned.

3. **Scan trashed blocks proactively**: When viewing a page's Trash (or the workspace Trash), scan for blocks that were deleted while carrying comments. Use the internal API to load comment threads for each trashed block.

### UI

A floating panel (fixed position, top-right) with:

- **Orphan count badge**: Shows number of orphaned comments detected on the current page
- **Panel toggle**: Click badge to expand/collapse the detail panel
- **Comment list**: Each orphaned comment shows:
  - The comment text (first 100 chars)
  - The original author
  - Timestamp
  - The parent block's name/type (if recoverable)
  - Days remaining before permanent deletion (Trash countdown)
  - Copy / Export button
- **Refresh button**: Re-scan the page
- **Export all**: Copy all orphaned comments as formatted text to clipboard

### Technical approach

**Option A — API hooking (preferred)**
Patch `fetch` and/or `XMLHttpRequest` to intercept Notion's internal API calls. Notion's web app uses a private API (`api/v3/*` endpoints) that returns richer data than the public REST API. The authenticated session cookie does the auth, so no API key is needed.

Target endpoints (reverse-engineer from network tab):
- `api/v3/getComments` or similar — returns comments for a page/block
- `api/v3/getBlockRoles` — returns block metadata including trash status
- `api/v3/loadPageChunk` — loads page content including blocks

**Option B — DOM scanning (simpler, less reliable)**
Scan the page DOM for comment UI elements. In Notion's rendered page, inline comments appear as `💬` icons in the right margin. Each one is attached to a block (a `div[data-block-id]` parent). If a comment's `💬` icon is visible but its parent block is missing/ghost, that's a candidate. This approach won't find comments on already-purged blocks but can catch recently-trashed ones.

**Option C — Hybrid**
Use API hooking to collect comment data, DOM scanning to verify block visibility on the current page.

### Deliverable

A single `scripts/notion-comment-recovery.user.js` file.

### Skeleton

```javascript
// ==UserScript==
// @name         Notion Orphaned Comment Inspector
// @namespace    http://tampermonkey.net/
// @icon         https://www.notion.so/favicon.ico
// @version      0.0.1
// @description  Detects inline comments whose parent block has been deleted, before the 30-day purge
// @author       KakkoiDev
// @match        https://www.notion.so/*
// @grant        none          // no GM_* needed if intercepting fetch() and using navigator.clipboard
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ─── State ───────────────────────────────────────────────
    const orphans = new Map();   // commentId -> { text, author, parentBlockId, deletedAt, daysLeft }
    let panelEl = null;

    // ─── Hook Notion's internal API ──────────────────────────
    // 1. Override fetch() to intercept comment-related endpoints
    // 2. Parse response JSON for comment data with parent block IDs
    // 3. Cross-reference each parent block's existence via another API call

    // ─── Detection logic ────────────────────────────────────
    async function checkBlockExists(blockId) {
        // Call Notion's internal block status endpoint
        // Returns true if block exists and is not trashed
    }

    async function scanPageForOrphans() {
        // 1. Get all comments for the current page via hooked API
        // 2. For each comment, check if parent block is alive
        // 3. Collect orphans into the Map
        // 4. Update panel UI
    }

    // ─── UI ──────────────────────────────────────────────────
    function buildPanel() {
        // Floating panel with badge + expandable list
        // Position: top-right, z-index above Notion's UI
    }

    function updatePanel() {
        // Refresh the orphan count and detail list
    }

    // ─── Init ────────────────────────────────────────────────
    // Hook fetch on page load
    // Build UI panel
    // Scan on initial load and on page navigation (Notion is an SPA)
})();
```

### Questions to resolve during implementation

1. **Which internal API endpoint(s) does Notion use to fetch comments?** Open Chrome DevTools on a Notion page with inline comments, filter network tab for `comment`, inspect the response shape including `block_id` and `discussion_id`.

2. **How does Notion mark a block as trashed in its API responses?** Check `in_trash` field in `loadPageChunk` or `getBlockRoles` responses.

3. **Can the internal API list comments for a trashed block?** Try calling the comment endpoint with a trashed block's ID. If it still returns comments, the script can recover them.

4. **SPA navigation**: Notion is a single-page app. The script needs to re-scan on route changes (listen for `popstate` or observe DOM mutations on the main content area).

5. **Rate limiting**: Notion's internal API may throttle rapid requests. Batch/delay block existence checks.

### Related links

- [Research report](docs/RESEARCH-notion-orphaned-comments.md) — full findings on how Notion handles comments on deleted blocks
- [Notion public API — Working with comments](https://developers.notion.com/guides/data-apis/working-with-comments)
- [Notion public API — Delete a comment](https://developers.notion.com/reference/delete-a-comment)
- [Notion block reference](https://developers.notion.com/reference/block) — `in_trash` field
