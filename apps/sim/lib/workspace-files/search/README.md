# Workspace file search

PostgreSQL stores complete extracted text in bounded chunks. Object storage remains the source of truth. A source and its extracted UTF-8 text must each fit within 25 MiB. Unsupported, degraded, oversized, or partially extracted files are excluded in full. There is no row-count or line-count coverage limit.

## Storage and publication

- `workspace_file_search_revision` has one current state row per file. The `build_id` identifies the attempt; only `ready` builds are visible to search.
- `workspace_file_search_build` owns an immutable chunk set. Workers receive a fresh build ID on each attempt. An unpublished build has a 20-minute lease; a published build has no expiry.
- `workspace_file_search_chunk` packs complete short lines into at most 8 KiB of UTF-8 text. Long lines use fragments with a two-code-point overlap and the same logical line number. PostgreSQL enforces the byte bound. No large document is stored as one text value.

8 KiB values may still use PostgreSQL TOAST. The bound controls the size of each logical value and detoast operation; avoiding TOAST entirely is not the objective. Tiny lines share rows, so row count scales with bytes instead of newline count. Worst-case line packing can leave roughly half a block unused; long-line overlap adds at most eight bytes per fragment.

Workers download and extract outside database transactions, then insert batches of at most 250 rows / 1 MiB. Each batch checks the build token and lease. Publication locks the canonical file, build, and revision in that order, verifies the stored chunk count, and changes the visible pointer only after every batch succeeds. Old dispatch failure callbacks cannot overwrite newer dispatches or successful builds.

The indexing task uses an isolated `medium-2x` Trigger worker (4 GB RAM). Document parsers can materialize expanded content before chunking, so source and extracted-text byte limits do not bound parser memory. Parser complexity guards and the worker's memory budget remain separate protections.

File edits, context changes, and deletion invalidate metadata and expire builds. Chunks have no cascading foreign key to files or workspaces. Cleanup locks at most 100 expired builds with `SKIP LOCKED`, deletes at most 1,000 chunks per transaction, retires empty builds in the same batch, and stops after 10 batches or five seconds. Dispatch pauses while at least 10,000 expired chunks await cleanup, so sustained revisions cannot keep admitting new builds faster than retirement can drain them. Existing ready files remain searchable. Stale workers cannot revive a reclaimed build.

## Search

Search joins the current file revision and resolved workspace/folder scope. A repeatable-read transaction prevents a search from combining revisions while a file changes. The composite workspace/text GIN index supplies candidate chunks. An unordered probe retains at most 257 candidate headers. If it exhausts the candidates, those headers are sorted and verified. If it overflows, an ordered file scan retrieves at most 16 candidate headers per page using the build/line B-tree index. This avoids sorting or detoasting every matching chunk for common terms. Both paths return unique lines ordered by file name, file ID, and line number.

For regular chunks, PostgreSQL checks the pattern with newline-aware semantics, then verifies individual logical lines. Long-line fragments use only necessary three-character literals as a conservative prefilter, including all required alternation branches. Two-code-point overlap preserves those literals at every boundary. PostgreSQL reconstructs the complete candidate line and evaluates the original regex, so anchors, word boundaries, repetitions, and arbitrarily long match spans retain line semantics. Fixed overlap alone is never treated as proof of a match. The supported regex grammar and minimum literal requirement are unchanged.

Regular blocks are verified in batches of at most 16 (128 KiB of indexed text); long lines are reconstructed one at a time. Only bounded match-centered previews leave PostgreSQL: at most 201 rows to detect truncation, and at most 2 KiB per rendered result. A single search has a ten-second application deadline with per-statement guards. PostgreSQL 17 additionally enforces a total transaction timeout; PostgreSQL 16 uses the compatible idle-transaction guard. Transaction advisory locks admit at most 20 simultaneous searches per workspace and 5,000 globally per database. The application connection pool queues requests when its connections are occupied. These admission ceilings are operational safeguards, not throughput guarantees. Busy and timed-out searches fail explicitly; they never report an incomplete scan as an authoritative empty result. The reader uses the normal application database connection, so admission is coordinated on the same database as the index.

Arbitrary regex cannot have a fixed latency guarantee. Common terms, broad alternatives, and punctuation-only literals may require scanning significant scoped text. Larger capacity decisions need representative query plans and workload measurements; neither a per-file byte cap nor a PostgreSQL row-count claim establishes a total corpus capacity.

Build leases use PostgreSQL time for creation, validation, and retirement, so worker clock drift cannot expire a healthy attempt or delay reclaiming a retired build.

## Agent search and read

Search results retain `fileId`, 1-based `lineNumber`, and bounded `text` previews. File Get Content and the v2 text reader use the same complete-text parser configuration, so CSV duplicate headers and late spreadsheet cells do not shift or disappear behind preview limits. An agent can request `fileId`, `offset`, and `limit` for surrounding text. These are extracted-text lines, not PDF page or worksheet row numbers; a file edit between calls requires a new search. Ranged reads count lines in place and materialize only the selected window rather than building an array entry for every line.

## Rollout and retirement

1. Deploy the additive migration and new application/Trigger worker versions. Legacy index tables remain readable for the old deployment. The file trigger queues current revisions in the new table; this cutover intentionally allows temporary search unavailability while the new index builds.
2. The dispatcher uses a separate `workspace-file-search-chunks-v2` backfill cursor. It seeds at most 1,000 active files per pass under a shared file lock, with idempotent inserts. Normal dispatch caps remain two outstanding jobs per workspace, 100 outstanding globally, and ten running workers. Reconciliation repeats hourly after a complete pass to repair missing metadata. Failed revisions remain visible as failed; they are not silently declared covered.
3. Before retiring legacy storage, verify the new app and Trigger workers are fully deployed, old runs/retries have drained, the backfill cursor has completed, and scoped coverage is ready or explicitly excluded. Investigate failed or stale pending revisions. Check cleanup backlog and run representative exact/regex searches, including long lines and folder scopes.
4. After the rollback window, ship a separate contract PR removing the legacy schema and dropping `workspace_file_search_segment` / `workspace_file_search_index` with a short lock timeout. Do not delete the entire old index row-by-row or backfill it inside the schema migration. Dropping obsolete tables reclaims their heap, indexes, and TOAST together. The `contract-pending` marker in `packages/db/schema.ts` tracks this step.

Until that contract deploy, legacy foreign-key cascades can still make a hard file/workspace deletion expensive. New-index cleanup is bounded; retaining the old schema cannot erase that legacy cost. The earlier timestamp-repair script detects the chunk schema and leaves obsolete legacy text for this contract step instead of deleting it in bulk. No production cleanup is part of this PR.

Rollback before retirement requires restoring the old trigger function as well as the old app/worker version, and reconciling legacy revisions written during the cutover. Do not assume retained tables are automatically up to date. Canonical revision joins prevent stale content from being returned.

## Verification

Run unit tests in `apps/sim` with `bunx vitest run lib/workspace-files/search lib/file-parsers`. Run the PostgreSQL suites on both PostgreSQL 16 and 17 against a disposable local database through `KNOWLEDGE_ACL_TEST_DATABASE_URL` and `--mode integration`. `chunks.integration.ts` applies the actual trigger migrations in an isolated schema. It covers build fencing, revision changes, deletion, cleanup bounds, complete-line matching, UTF-8 boundaries, scope, and admission limits.

Set `FILE_SEARCH_BENCHMARK_FILES` to change the synthetic file count (default 1,000, maximum 10,000). Set `FILE_SEARCH_BENCHMARK_OUTPUT` to an output path when running the chunk integration suite to record repeated end-to-end searches and `EXPLAIN (ANALYZE, BUFFERS)` plans on a synthetic multi-file corpus. The fixture is synthetic; it contains no production content.

## PostgreSQL references

The design uses PostgreSQL's documented [TOAST behavior](https://www.postgresql.org/docs/17/storage-toast.html), [trigram index support for LIKE and regex](https://www.postgresql.org/docs/17/pgtrgm.html), and [EXPLAIN guidance](https://www.postgresql.org/docs/17/using-explain.html). The chunk size and query paths are application choices validated by the synthetic fixture, not PostgreSQL hard limits.
