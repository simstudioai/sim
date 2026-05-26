---
name: memory-load-check
description: Review PRs and diffs for unbounded memory loading, concurrency explosions, oversized payload materialization, and missing pagination or byte caps. Use when reviewing cleanup jobs, background jobs, data imports/exports, file parsing, API fan-out, workflow execution payloads, large arrays/files, or any change that reads many rows, files, responses, logs, or external API pages into process memory.
---

# Memory Load Check

Use this skill when a PR or diff could load unbounded data into a Node/Bun process, especially in cron routes, background tasks, API routes, workflow execution, file parsing, cleanup jobs, migrations, import/export flows, and external API integrations.

## Review Goal

Prove each changed path has explicit bounds for:
- rows held in memory
- bytes held in memory
- concurrent promises, DB queries, HTTP calls, storage operations, and jobs
- number of pages, batches, chunks, retries, and retained intermediate objects

If any bound depends only on current production size or "probably small" data, treat it as a finding.

## References

Read these when doing a deeper pass:
- Node.js streams/backpressure: https://nodejs.org/learn/modules/backpressuring-in-streams
- Node.js stream usage: https://nodejs.org/en/learn/modules/how-to-use-streams
- Keyset/cursor pagination over offset scans: https://blog.sequinstream.com/keyset-cursors-not-offsets-for-postgres-pagination/
- Postgres pagination tradeoffs: https://www.citusdata.com/blog/2016/03/30/five-ways-to-paginate/

## Sim Helpers To Prefer

- `apps/sim/lib/cleanup/batch-delete.ts`
  - `chunkedBatchDelete`: bounded SELECT -> optional side effect -> DELETE loop.
  - `batchDeleteByWorkspaceAndTimestamp`: common workspace/timestamp cleanup wrapper.
  - `selectRowsByIdChunks`: chunks large ID sets and enforces an overall row cap.
  - `chunkArray`: use only after the input set itself is already bounded.
- `apps/sim/lib/core/utils/stream-limits.ts`
  - `PayloadSizeLimitError`
  - `assertKnownSizeWithinLimit`
  - `assertContentLengthWithinLimit`
  - `readStreamToBufferWithLimit`
  - `readNodeStreamToBufferWithLimit`
  - `readResponseToBufferWithLimit`
  - `readResponseTextWithLimit`
- Cleanup dispatcher pattern in `apps/sim/lib/billing/cleanup-dispatcher.ts`
  - page active workspaces with `WHERE id > afterId ORDER BY id LIMIT N`
  - dispatch concrete chunks (`workspaceIds`, retention, label) instead of one giant scope
  - prefer Trigger.dev queue/concurrency keys when available
  - execute inline fallback chunks sequentially, not with unbounded `Promise.all`
- File parse route pattern in `apps/sim/app/api/files/parse/route.ts`
  - cap downloads and parsed output separately
  - preserve partial results when a later item exceeds the cap
  - never read untrusted response bodies without a byte cap
- Large workflow value payloads
  - prefer durable references/manifests over inlining large arrays or files
  - materialize refs only behind an explicit byte budget

## Review Workflow

1. Identify every changed data source:
   - database queries
   - storage lists/downloads/uploads
   - external API pagination
   - file reads and HTTP responses
   - workflow logs, snapshots, payloads, arrays, and manifests
   - queues, cron routes, and background jobs
2. For each source, write down the maximum cardinality and maximum bytes. If the code does not enforce one, it is unbounded.
3. Trace whether data is processed incrementally or accumulated:
   - arrays from `select`, `findMany`, `Promise.all`, `map`, `filter`, `flatMap`
   - maps/sets keyed by all users, workspaces, executions, files, or rows
   - `Buffer.concat`, `response.arrayBuffer()`, `response.text()`, `JSON.stringify`, `JSON.parse`
   - queues of promises or job payloads built before dispatch
4. Check concurrency separately from memory:
   - no `Promise.all(items.map(...))` unless `items` is already small and bounded
   - use chunks, sequential loops, queue concurrency, or a concurrency limiter
   - align concurrency with DB pool size, storage/API limits, and task queue semantics
5. Verify SQL shape:
   - every bulk query has `LIMIT`
   - large pagination uses cursor/keyset style (`id > afterId`, timestamps plus unique ID), not deep `OFFSET`
   - `IN (...)` lists are chunked
   - side-effect rows selected before delete have per-batch and per-run caps
6. Verify byte safety:
   - check `Content-Length` when available
   - stream with cumulative byte accounting
   - cap both input bytes and expanded output bytes
   - reject or reference oversized values before serializing large JSON responses
7. Confirm failure behavior:
   - exceeding a cap should stop before loading more data
   - partial successful work should be preserved when the API contract expects it
   - retries should not duplicate huge in-memory state
   - cleanup jobs should make progress over future runs instead of widening one run

## Red Flags

- loads all active workspaces, users, executions, logs, files, messages, or subscriptions before filtering
- builds a full `Map` or `Set` for a platform-wide scope
- uses `Promise.all` over rows from an unbounded query
- fetches all pages from an external API before processing
- reads an entire file, HTTP response, or stream without a max byte budget
- checks size only after `Buffer.concat`, `arrayBuffer`, `text`, `JSON.parse`, or parse expansion
- chunks only after loading the complete dataset
- paginates with unbounded/deep `OFFSET` on a mutable or large table
- creates one queue job per row without batching or a queue-level concurrency key
- accumulates per-row errors/results with no maximum
- adds a cache, singleton, or module-level collection without eviction or size limits

## Preferred Fixes

- Move filters into SQL/API requests and select only needed columns.
- Replace full-table loads with cursor/keyset pagination and a deterministic order.
- Process one page/batch at a time; do not keep previous pages unless needed.
- Add per-batch and per-run row caps so long backlogs drain across repeated jobs.
- Split large ID lists with `selectRowsByIdChunks` or `chunkArray` after bounding the source.
- Use `chunkedBatchDelete` for cleanup loops with row side effects.
- Use stream-limit helpers for file/HTTP/body reads.
- Store large workflow values as refs/manifests and materialize only within a caller budget.
- Replace unbounded `Promise.all` with sequential chunk loops, queue concurrency, or a small limiter.
- Include tests that prove caps stop work early and partial results or progress are preserved.

## Findings Format

Lead with concrete findings, ordered by risk:

```markdown
## Findings

- **P1 Unbounded workspace load in cleanup dispatch** (`path/to/file.ts`)
  The new path calls `select().from(workspace)` without a limit, then builds maps for every row before dispatch. In production this scales with all active workspaces and can exhaust the app process. Page by `workspace.id` with a fixed limit and dispatch bounded chunks.

## Good Signals

- Uses `readResponseToBufferWithLimit` for external downloads.
- Inline fallback processes chunks sequentially.

## Residual Risk

- The row cap is explicit, but no test currently proves the loop stops at the cap.
```

Only say "good to go" when every changed source has explicit row, byte, and concurrency bounds or the boundedness is proven by a stable invariant.
