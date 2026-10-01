# Retiring legacy Search indexes

`0029_retire_all_search_embeddings` runs through the existing script-migration registry without
cleanup flags. It supersedes the single-KB retirement and maintenance entries (`0027`/`0028`),
including databases that already recorded either receipt. It snapshots every knowledge base whose
persisted `is_search_index` marker is true. No Search KB is a completed no-op. Once saved, the
snapshot stays fixed across retries even if another Search KB is created. Ordinary KBs and the
selected KBs' live source/credential configuration, document metadata, and backing files are preserved.

## Deployment and execution

The app and workers must already use live Search, and older indexing jobs must be drained before
this cleanup ships: deployment migrations run before the new app switches over. `SIM_SEARCH_LIVE=true`
(the default) makes `isIndexedOrgSearchEnabled()` false. **`SIM_SEARCH_LIVE=false` enables indexed
Search again.** The cleanup does not inspect this flag. Live source setup may still create a Search
KB for configuration; it does not index content. Document uploads, dispatch and queued processing
also honor the indexed-search gate. The app does not depend on the cleanup finishing: once documents
are retired, what remains is storage reclamation.

The cleanup is a background data migration, in the pattern of GitLab's
[batched background migrations](https://docs.gitlab.com/development/database/batched_background_migrations/):
the deploy starts it, a background runner advances it between deploys, throttled on database
health, and the journal records it only once it is finished.

- **Deploy slice.** The ordinary migration runner applies `0029_retire_all_search_embeddings` with a
  one-minute budget. It captures the target snapshot on first run, advances the retirement, and
  throws `ScriptMigrationDeferred`, so the runner leaves it unrecorded and the release proceeds. It
  never starts index maintenance. If the background runner holds the retirement lock, the deploy
  slice defers at once without running a page.
- **Background runner.** `.github/workflows/search-retirement.yml` runs a slice every hour against
  staging and production with the same secrets, and therefore the same migration role, as
  `migrations.yml`. Each hourly slice may start pages for 50 minutes. A daily slice in an off-peak
  window (03:07 UTC) may also start index rebuilds and vacuums for two hours. The first slice that
  finishes retirement and maintenance records `0029` and its superseded names in
  `script_migrations`; later slices find nothing pending. The migration role is used because it
  owns these tables, which the rebuilds and vacuums require, and can read replication statistics.
  GitHub runs scheduled workflows from the default branch, so the schedule starts once this ships
  to `main`. Remove the workflow once `0029` is journaled in every environment.
- **Manual slice.** `bun run packages/db/script-migrations/0029_retire_all_search_embeddings.ts
  [--budget-minutes N] [--maintenance]`, with the writer supplied through
  `MIGRATION_DATABASE_URL`/`DATABASE_URL`, runs one slice the same way. Without `--budget-minutes` it
  runs until the retirement finishes; without `--maintenance` it never starts a rebuild or vacuum.
  Self-hosted deployments without the workflow use this command to finish the cleanup.

A session advisory lock lets only one runner retire pages at a time, and another serializes
maintenance. No page starts after a slice's budget; the page in flight when the budget runs out
finishes or rolls back with its cursor, so a slice can overrun its budget by at most one page.
Cancelling a slice at any point loses at most its in-flight page.

### Pacing

Each page mutates at most a row limit of target rows and reads at most four IDs per row of that
limit, never more than 25,000 IDs. Retiring a document is a non-HOT update that writes every index
on `document`, and deleting a chunk cascades into its projections, so a page's cost follows the
target rows it mutates, not the IDs it reads. A page that reaches the row limit advances the cursor
only to its last mutated row; the rest of its scan is read again by the next page. Documents that are
already retired never count against the limit.

The row limit starts at 2,000 rows, never drops below 25 and never exceeds 8,000. A page is timed
from the start of its transaction through its commit, including any lock-timeout retries. A page
slower than 30 seconds halves the limit. A page faster than 7.5 seconds doubles it, which also
widens the scan window. Phase changes do not adjust it.

After every page the cleanup pauses for the longest of:

- **Duty cycle**: as long as the page took, so the cleanup is busy at most half the time.
- **WAL budget**: long enough that the WAL the whole database wrote during the page, spread over
  the page and the pause, stays within 10% of `max_wal_size` per `checkpoint_timeout`. The rate is
  read from `pg_current_wal_lsn()` before and after each page and counts every writer, so the cleanup
  yields when the application itself writes heavily. Holding WAL well below `max_wal_size` keeps
  checkpoints time-triggered. When WAL outruns `max_wal_size`, checkpoints start back to back. The
  first change to each page after a checkpoint logs the whole page, so WAL grows further, and
  synchronous commits slow down for every writer.
- **Commit back-off**: a page whose commit took longer than one second halves the row limit and
  waits 15 seconds, doubling while commits stay slow. The commit is timed separately from the page's
  statements, so it isolates the synchronous-replication wait and checkpoint fsync pressure that
  every other writer is also paying.

Before each page the cleanup also reads `pg_stat_replication`; a replica whose write, flush or
replay lag exceeds 10 seconds pauses the cleanup with the same doubling back-off. Without replicas,
or without `pg_read_all_stats`, the lag reads as unknown and only the other signals apply. No pause
exceeds five minutes. Each pause is cut short at the slice's budget.

Materialized SQL pages keep the IDs inside PostgreSQL; the migration process receives only a cursor
and a validation result. Each page uses a two-minute statement timeout and a one-second lock
timeout. If a page's mutating statement exceeds the statement timeout, the page rolls back with its
cursor and is retried with half the row limit after a duty-cycle pause. From then on, fast pages grow
the limit only up to that halved size. A page that still times out at 25 rows fails the slice. Any
other statement timeout fails the slice at once, because a smaller page cannot speed it up. The
completion rechecks, which walk every captured KB once, run with a 30-minute timeout. Brief lock
timeouts retry the rolled-back page with bounded backoff for up to one minute. Other errors, or
exhausted lock retries, fail the slice without a completion receipt; the next slice resumes.

### Observing

Every page logs one `Search retirement batch` line with its phase, rows mutated, page and commit
duration, WAL bytes, the pause it chose and the signal that set it (`duty`, `wal`, `backoff`,
`slow_commit`, `slow_page` or `phase_change`), and the current row limit. A replica-lag pause logs a
`replica_lag` batch line without rows. Every ten pages the cleanup also logs its cursor and running
totals, and it logs each phase change, the completion recheck and each deferral. In production,
also watch primary commit latency, checkpoint frequency (`checkpoint starting: wal` in the server
log means WAL is forcing them), replica lag and free disk.

### Pausing and resuming

Pause the background runner with `gh workflow disable search-retirement.yml` and cancel any
in-progress run; the in-flight page rolls back with its cursor. Deploys keep advancing the cleanup
for one minute each while the workflow is disabled. Resume with `gh workflow enable` or a manual
`workflow_dispatch`. Nothing is reset on resume: every slice continues from the saved scope, phase,
cursor and maintenance checkpoints.

### Legacy checkpoints

`0029` supersedes the single-KB retirement and maintenance entries (`0027`/`0028`), including
databases that already recorded either receipt. On upgrading a legacy single-KB checkpoint, the
snapshot and cursor reset commit atomically. The scan starts at the beginning once so it includes
other KBs behind the old cursor; previous deletes remain committed. Maintenance checkpoints also
reset once because the expanded cleanup creates new dead entries. A completed legacy checkpoint
does not require its former KB to still exist or remain Search-marked; the new snapshot selects
current Search KBs and preserves any KB now marked ordinary. An unfinished legacy checkpoint still
requires its target to remain Search-marked. Subsequent slices resume the saved scope, phase, cursor
and maintenance checkpoints.

Every slice requires a direct or session-pooled PostgreSQL connection, as the deployment
migration runner already does for its session advisory locks and settings. `DATABASE_URL` is a valid
fallback only when it provides that session affinity. PgBouncer transaction pooling is unsupported;
reserving a postgres.js client connection does not pin a backend through a transaction pooler.

The runner-owned `search_embedding_cleanup_targets` table stores the frozen KB set, populated in
bounded SQL pages within one repeatable-read transaction. The existing `search_embedding_cleanup_progress`
row stores the shared phase and ID cursor; its legacy `knowledge_base_id` remains an informational
anchor, not the full deletion scope. Page mutations and cursor advancement commit together.
The one-off migration journal records only completion. `db:push` excludes both bookkeeping tables
from schema diffing.

The documents phase fences queued and in-flight processing by marking only target documents
excluded/disabled and clearing their dispatch stamps. The embeddings phase deletes only target
chunks, and refuses a page whose target document was not retired or has inconsistent ownership.
The existing foreign keys cascade to vector/keyword projections and chunk provenance. Both phases
walk the primary key once for the entire captured set in bounded pages; ordinary rows are never
updated. Each page locks and rechecks the Search markers for its target KBs before mutation, and
fails atomically if any target changed to an ordinary KB. This avoids a separate full-table scan
per KB or sorting a whole KB when no suitable composite cleanup index exists. Resumption continues the saved scan, including across pages containing only
unrelated rows. Before completion, the cleanup checks for unretired documents and remaining chunks
behind either cursor and restarts the affected phase if needed. A final bounded pass validates all
captured KB markers, including empty KBs and KBs whose rows were already scanned, holding shared
marker locks until the completion checkpoint commits. Resuming a completed cleanup before maintenance
also revalidates the captured set, with the same 30-minute timeout as the completion recheck. Keep target writers stopped and
do not change their Search markers during the pass.

Inspect progress with:

```sql
SELECT * FROM search_embedding_cleanup_progress;
SELECT name, applied_at FROM script_migrations
WHERE name IN ('0027_retire_search_embeddings', '0028_maintain_search_retirement',
               '0029_retire_all_search_embeddings');
```

After completion, check the selected KBs have no `embedding` rows, verify their live Search, and verify
ordinary KB retrieval. A zero-row absence check may still scan index entries; use an appropriate
timeout. The cleanup is destructive and not reversible by flipping the search flag. Re-enabling
indexed Search requires deliberately restoring document eligibility and fully resyncing its sources.

## Storage maintenance

Once retirement completes, a slice allowed to run maintenance runs `REINDEX INDEX CONCURRENTLY` on
each HNSW index of `embedding_search`, then `VACUUM (ANALYZE, TRUNCATE FALSE)` on the vector and
keyword projections, chunk provenance, embeddings, and documents. Deploy slices and hourly slices
never start these; only the off-peak daily slice or a manual `--maintenance` slice does. Operations
run sequentially outside transactions, and none starts after the slice's budget. One that already
started runs to completion, because an interrupted concurrent rebuild starts over and a large index
cancelled at every deadline would never finish. The job timeout leaves room for that.

Rebuilds keep ordinary reads and writes available, but each writes its whole new index to WAL and
needs temporary index space; they wait for older transactions. A manual `VACUUM` is not cost-limited
by default, so maintenance runs it with autovacuum's default `vacuum_cost_delay` of 2 ms to spread
its I/O and WAL. PostgreSQL's `pg_stat_progress_create_index` and `pg_stat_progress_vacuum` expose
progress.

The existing progress row gains `reindexed_through` and `vacuumed_tables` checkpoints. Completed
indexes and tables are skipped on retry; interruption between an operation and its checkpoint may
repeat that one operation. Invalid `_ccnew`/`_ccold` siblings from an interrupted concurrent rebuild
are removed concurrently before retrying their original index. One advisory lock serializes the
maintenance worker. Do not run other index maintenance on these tables at the same time.

Ordinary vacuum makes dead space reusable and refreshes planner statistics; it generally does not
shrink table files. This migration does not run `VACUUM FULL` or rewrite tables. See the
[PostgreSQL vacuum documentation](https://www.postgresql.org/docs/17/sql-vacuum.html),
[concurrent reindex recovery](https://www.postgresql.org/docs/17/sql-reindex.html#SQL-REINDEX-CONCURRENTLY),
and [pgvector maintenance guidance](https://github.com/pgvector/pgvector#vacuuming).

Document counts are historical until a later document cleanup. Do not raw-delete documents or
bucket objects: their application hard-delete path also enqueues identity-bound storage cleanup
and applies accounting. Its ordinary scoped mode excludes retired documents, so a follow-up must
explicitly support these rows while preserving those side effects. Do not delete source accounts,
integration policies or permission grants used by live Search.
