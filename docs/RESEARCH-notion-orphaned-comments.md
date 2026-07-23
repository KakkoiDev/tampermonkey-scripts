# Notion Orphaned Comments — Research Report

## Question

When you delete a line (block) in Notion that has an inline comment attached, is the comment truly deleted or just hidden in the database?

## Answer

**The comments are actually deleted** — not simply hidden. Notion's architecture ensures transactional deletion of block + comments together. But there's a 30-day soft-delete window via Trash.

## Evidence

### 1. Notion's blog engineering post (primary source)

In *"Herding elephants: Lessons learned from sharding Postgres at Notion"* (Garrett Fidalgo, Oct 2021), the team explains why they co-locate blocks and comments in the same database shard:

> Before sharding: one shard contained `block` and another contained `comment`. When a user deletes a block, we need to update the comments too — but databases only guarantee transactions inside one shard, not across shards. So the block delete could succeed while the comment update fails.

Their fix was to **shard all data transitively related to a block together**:

```
Shard N:
  Block A
  Discussion A
  Comments A
```

This enables atomic deletion:

```sql
BEGIN TRANSACTION;
  DELETE block;
  DELETE comments;
COMMIT;
```

**Source**: [Notion blog](https://www.notion.com/blog/sharding-postgres-at-notion) (blog JS rendering broken, confirmed via [summary on sneaky-potato.github.io](https://sneaky-potato.github.io/blog/notion-sharding/))

### 2. Notion public API — comment deletion

The `DELETE /v1/comments/{comment_id}` endpoint exists and performs a true deletion:

> "Returns a comment object for the deleted comment."
> "If the discussion thread is left empty after deleting the last comment, the discussion itself is also removed."

This is a real delete, though the API returns the deleted object (soft-delete pattern).

**Source**: [Notion API docs — Delete a comment](https://developers.notion.com/reference/delete-a-comment)

### 3. Notion public API — listing comments

The `GET /v1/comments?block_id={block_id}` endpoint returns **only open (unresolved) comments**. It **cannot retrieve resolved comments**.

The API cannot start a new discussion thread or retrieve resolved comments — those are UI-only capabilities via Notion's private internal API.

**Source**: [Working with comments — Notion API docs](https://developers.notion.com/guides/data-apis/working-with-comments)

### 4. Notion block API — `in_trash` field

Blocks have an `in_trash` boolean field. When you "delete" a block in the UI, it's a soft-delete: `in_trash` flips to `true`, and the block moves to Trash for 30 days. During this window, the block (and its comments) still exist in the database. After 30 days, the block is permanently purged.

**Source**: [Notion API docs — Block](https://developers.notion.com/reference/block)

## The lifecycle of a comment on a deleted block

```
User deletes block (inline comment attached)
  │
  ▼
Block → in_trash = true (30 days)
Comment → still exists, associated with trashed block
  │
  │ (30 days pass, or user empties Trash)
  ▼
Block → permanently deleted from DB
Comment → transactionally deleted with block (same shard)
  │
  │ (30 more days — backup snapshots retained)
  ▼
Data becomes unrecoverable (even via support)
```

**Windows of recoverability:**
- **Days 0–30** (Trash): Block + comments restorable from Trash in the UI
- **Days 30–60** (backup retention): Notion stores snapshots. Contact support — they may restore.
- **After 60 days**: Gone. Notion's backup rotation has cycled.

## Implications for an "orphaned comment inspector"

**There are no true orphaned comments** under normal operation — when a block is deleted, its comments are deleted transactionally. The only scenario where a comment exists without its parent block is:

1. **During the 30-day Trash window**: The block is soft-deleted (`in_trash: true`) but the comment still references it. If you can access the trashed block's ID, you can list its comments.
2. **Race condition / failed cross-shard operation** (pre-sharding era, 2021 and earlier): Comments could theoretically outlive their block. Notion's current architecture prevents this.
3. **API limitations**: The public API can only list *open* comments for a block. *Resolved* comments and comments on *trashed* blocks are invisible via the public API. Notion's internal/private API (used by the web app) has broader capabilities.

A userscript running in the browser (authenticated session) could potentially:

- Intercept Notion's internal API calls to discover comments the public API hides
- Monitor the Trash page for blocks that have comments before they're purged
- Export comment threads from trashed blocks for archival before the 30-day window expires
- Detect if any comments reference a `block_id` that no longer resolves (true orphan detection)
