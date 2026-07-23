# Notion internal comment API - spike results (verified)

Captured 2026-07-23 via chrome-devtools MCP against a real logged-in workspace (app.notion.com).
These are the facts the userscript is built on. No guesses - every point was observed live.

## Host

Notion now serves the app on `app.notion.com` (login at `notion.so` redirects there).
All internal API calls are same-origin under `/api/v3/*`, so the script uses **relative** fetch
URLs and works regardless of which notion host the tab is on.

## Endpoints

| Endpoint | Use |
|---|---|
| `POST /api/v3/syncRecordValues` | Read records by pointer. Body `{"requests":[{"pointer":{"table","id","spaceId"},"version":-1}]}`. Returns `recordMap.{table}.{id}.value.value`. **Auth = session cookies only** (no token header). |
| `POST /api/v3/loadCachedPageChunkV2` | Page content. Body `{"page":{"id":PAGE_ID},"cursor":{"stack":[]},"verticalColumns":false}`. Returns **alive blocks only** (`block`, `collection`, `team` record maps). Cached snapshot - may lag a fresh write. |
| `POST /api/v3/saveTransactionsFanout` | Writes (comment create, block trash). Reference only - the script never writes. |

## Data model (comment on a block)

```
block  .discussions[]  -> [discussionId, ...]
       .alive          -> false === trashed  (NO in_trash / moved_to_trash field; alive is the flag)
       .properties.title -> [["text",[annotations]]]  (also crdt_data.title in new CRDT format)

discussion .parent_id / .parent_table("block")
           .resolved   -> bool  (resolved comments hidden by Notion UI; still returned here)
           .context    -> [["anchored text", [["m", discussionId]]]]   (the anchor snippet)
           .comments[] -> [commentId, ...]

comment .parent_id / .parent_table("discussion")
        .text          -> [["comment body", ...]]   (rich-text array)
        .created_by_id  (notion_user id)  / .created_time / .last_edited_time
        .alive         -> bool
```

Author name: fetch `notion_user` records by `created_by_id` via the same syncRecordValues call.

## The decisive results

1. **A comment on a trashed block is fully retrievable by id.** After deleting the block,
   `syncRecordValues` for the same block/discussion/comment ids still returns:
   `block.alive=false`, and the discussion + comment records intact (text, author, resolved,
   anchor context, timestamps). This is what makes the tool possible.

2. **Resolved comments come back too** (the public REST API cannot see these).

3. **`page.format.orphaned_discussions` catches SOME orphaned comments, but not all.** The page
   block carries, in its `format`, an `orphaned_discussions: [discussionId, ...]` array. Verified: a
   top-level block deleted directly under the page put its discussion here (live, no snapshot). BUT
   for a block deleted while nested in a column (whose container survived), the discussion did NOT
   appear in any ancestor's `orphaned_discussions` - the deleted block was `alive:false` and still
   held `discussions:[...]`, but nothing on the page indexed it. So `orphaned_discussions` is a
   partial signal, not a complete list of deleted-block comments.

4. **Version history is the reliable enumerator for deleted-block comments.** Any block that ever
   held a comment appears (alive, with its `discussions[]`) in the page's past snapshots:
   - `POST /api/v3/getSnapshotsList` body `{"block":{"id":PAGE_ID,"spaceId":SPACE},"size":100}`
     -> `snapshots[].timestamp`.
   - `POST /api/v3/getSnapshotContents` body `{"block":{"id":PAGE_ID,"spaceId":SPACE},"timestamp":TS}`
     -> `contentMap.block[*]` with each block's `discussions[]` (+ page block `format.orphaned_discussions`).
   Union the discussion ids across all snapshots -> fetch each live -> the ones whose current parent
   block is `alive:false` are the deleted-block comments. Verified: recovered a discussion on a
   deleted, column-nested block that `orphaned_discussions` missed.

   - `syncRecordValues` needs **no** `spaceId` in the pointer; the returned record carries `space_id`
     (used to feed the snapshot calls, which DO need it).

   Honest limits: version history is periodic + retention-limited (often a paid feature). A comment
   on a block created-and-deleted between two snapshots, older than retention, or hard-deleted, can't
   be recovered - nothing references it.

## Script mechanism (derived from the above)

Enumerate the page's discussion ids from live sources + version history, then fetch + categorize.
No fetch/XHR hook, no localStorage, no passive observation - fully retroactive.

1. Fast scan (on page load): `syncRecordValues` the page block -> `format.orphaned_discussions`;
   `loadCachedPageChunkV2` -> alive blocks' `discussions[]`. Renders open/resolved/some-orphaned fast.
2. Deep scan (auto-fires after fast scan): `getSnapshotsList` + `getSnapshotContents` over all
   snapshots -> every discussion id ever anchored -> recovers deleted-block comments.
3. `syncRecordValues` the union of discussion ids + `comments[]` + parent blocks + authors.
4. Categorize: `!parentBlock || parentBlock.alive===false` -> deleted; `discussion.resolved` ->
   resolved; parent alive but no longer lists the discussion -> anchor-removed; else open.
5. Group comments by discussion (thread order) and render the floating archive panel; export.
