# Retiring legacy Search indexes

The retirement is an **operator-run maintenance command, not a deploy step**. Deploy migrations no
longer register it: a long cleanup inside the deploy migration generated heavy WAL and stalled
application writes, and it held the release until it finished. It is optional storage reclamation
once live Search is on, so it runs separately, paced, at a time the operator chooses. Self-hosted
operators can run the same command.

`0029_retire_all_search_embeddings` snapshots every knowledge base whose persisted `is_search_index`
marker is true and supersedes the single-KB retirement and maintenance receipts (`0027`/`0028`),
including databases that already recorded either. No Search KB is a completed no-op. Once saved, the
snapshot stays fixed across runs even if another Search KB is created. Ordinary KBs and the selected
KBs' live source/credential configuration, document metadata, and backing files are preserved.

## Before running

The app and workers must already use live Search, and older indexing jobs must be drained.
Enterprise Search no longer has an indexed backend or an environment toggle to re-enable it.
Older releases could re-enable indexed Search, so their workers must be drained before retirement. Live source setup may still
create a Search KB for configuration; it does not index content. Document uploads, dispatch and
queued processing also honor the indexed-search gate.

## Running it

From the repository root, with the migration role's writer DSN on a **direct or session-pooled**
connection (the run holds a session advisory lock and session settings; PgBouncer transaction pooling
is unsupported, and reserving a postgres.js client does not pin a backend through it):

```sh
# Retire documents and delete their chunks, resuming the saved cursor. Safe to stop and rerun.
MIGRATION_DATABASE_URL=<direct DSN> bun run packages/db/script-migrations/0027_retire_search_embeddings.ts

# Off-peak: finish any remaining retirement, rebuild the HNSW indexes, vacuum, and record completion.
MIGRATION_DATABASE_URL=<direct DSN> bun run packages/db/script-migrations/0027_retire_search_embeddings.ts --maintenance
```

| Flag | Default | Effect |
| --- | --- | --- |
| `--pause-ratio N` | `2` | After each page, pause N × the page's duration (at most one minute), so the run is busy at most `1 / (1 + N)` of the time. Raise it to go gentler. |
| `--max-rows N` | `2000` | The most rows one page may update or delete (25–8,000). Lower it to make each page lighter. |
| `--maintenance` | off | After retirement, run the index rebuilds and vacuums and journal `0029` with its superseded names. |

Run it as the migration role: maintenance needs `pg_maintain`, which the application roles lack. Run
it outside peak traffic, and run `--maintenance` in the quietest window you have: concurrent HNSW
rebuilds are long and write a lot of WAL (GitLab, for example, schedules automatic reindexing for
weekends). Keep one run at a time.

**Pausing.** Ctrl-C is safe at any point. The in-flight page rolls back with its cursor, and an
interrupted concurrent rebuild's leftover index is removed on the next run. Rerun the same command to
resume; completed pages stay committed.

**Watching.** Every ten pages the run logs the phase, cursor, rows mutated so far and current row
limit; it also logs each halving after a slow page, each phase change, and the start of the completion
recheck. In PostgreSQL, watch for `checkpoint starting: wal` in quick succession, slow checkpoint
sync times, `canceling wait for synchronous replication`, and replica lag. If they appear, stop the
run and resume later with a higher `--pause-ratio` or lower `--max-rows`.

```sql
SELECT * FROM search_embedding_cleanup_progress;
SELECT name, applied_at FROM script_migrations
WHERE name IN ('0027_retire_search_embeddings', '0028_maintain_search_retirement',
               '0029_retire_all_search_embeddings');
```

A plain run does not journal anything; only a `--maintenance` run that finishes records `0029` and its
superseded names. On upgrading a legacy single-KB checkpoint, the snapshot and cursor reset commit
atomically. The scan starts at the beginning once so it includes other KBs behind the old cursor;
previous deletes remain committed. Maintenance checkpoints also reset once because the expanded
cleanup creates new dead entries. A completed legacy checkpoint does not require its former KB to
still exist or remain Search-marked; the new snapshot selects current Search KBs and preserves any KB
now marked ordinary. An unfinished legacy checkpoint still requires its target to remain
Search-marked.

## How a run paces itself

Each page mutates at most a row limit of target rows and reads at most four IDs per row of that
limit, never more than 25,000 IDs. Pages execute
sequentially, and each is followed by a pause of `--pause-ratio` times its duration, up to one
minute. Because a page is timed through its commit, a slow synchronous replica or a checkpoint stall
lengthens the following pause by the same factor. Retiring a document is a non-HOT update that writes every index on
`document`, and deleting a chunk cascades into its projections, so a page's cost follows the target
rows it mutates, not the IDs it reads. A page that reaches the row limit advances the cursor only to
its last mutated row; the rest of its scan is read again by the next page. Tying the scan window to
the limit keeps that re-reading proportional to the work, even after the limit shrinks. Documents
that are already retired never count against the limit.

The row limit starts at 2,000 rows, or `--max-rows` if lower. A page is timed from the start of its transaction through its
commit, including the synchronous-replication wait and any lock-timeout retries. A page slower than
30 seconds halves the limit. A fast page, one under 7.5 seconds, doubles it up to `--max-rows`, which
also widens the scan window, so sparse stretches are not crawled in small windows. The limit never drops below 25 rows. Phase changes do not adjust it.

Materialized SQL pages keep the IDs inside PostgreSQL; the migration process receives only a cursor
and a validation result. Each page uses a two-minute statement timeout and a one-second lock
timeout. If a page's mutating statement exceeds the statement timeout, the page rolls back with its
cursor and is retried with half the row limit after the usual pause. From then on, fast pages grow
the limit only up to that halved size, so a size that timed out is never tried again. A page that
still times out at 25 rows fails the migration. Any other statement timeout fails the migration at once, because a smaller page cannot
speed it up. The completion rechecks, which walk every captured KB once, run with a 30-minute
timeout. Brief lock timeouts retry the rolled-back page with bounded backoff for up to one minute.
Other errors, or exhausted lock retries, fail the migration without a completion receipt.

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

With `--maintenance`, after deletion, `0029` invokes the existing maintenance implementation to run `REINDEX INDEX CONCURRENTLY` on each HNSW index of `embedding_search`,
then `VACUUM (ANALYZE, TRUNCATE FALSE)` on the vector and keyword projections, chunk provenance,
embeddings, and documents. These operations execute sequentially outside transactions. Rebuilds
keep ordinary reads and writes available and require temporary index space and WAL capacity.
They wait for older transactions and can dominate total runtime. PostgreSQL's `pg_stat_progress_create_index` and `pg_stat_progress_vacuum` expose progress.

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

## Why it runs this way

Long data changes belong outside deploy migrations, in batches, throttled on database health, and
resumable from a cursor:

- [strong_migrations: Backfilling data](https://github.com/ankane/strong_migrations#backfilling-data)
- [GitLab batched background migrations](https://docs.gitlab.com/development/database/batched_background_migrations/)
  and [automatic reindexing](https://docs.gitlab.com/omnibus/settings/database/)
- [Shopify maintenance_tasks](https://github.com/Shopify/maintenance_tasks)
- [gh-ost throttling](https://github.com/github/gh-ost/blob/master/doc/throttle.md) and
  [pt-online-schema-change](https://docs.percona.com/percona-toolkit/pt-online-schema-change.html)
- [Stripe: online migrations at scale](https://stripe.com/blog/online-migrations)
- PostgreSQL 17: [WAL configuration](https://www.postgresql.org/docs/17/wal-configuration.html),
  [synchronous replication](https://www.postgresql.org/docs/17/warm-standby.html#SYNCHRONOUS-REPLICATION),
  [replication statistics](https://www.postgresql.org/docs/17/monitoring-stats.html)
- [PlanetScale: the only scalable delete](https://planetscale.com/blog/the-only-scalable-delete)
