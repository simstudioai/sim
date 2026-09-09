# Expiration acceptance and failure testing

This is the acceptance matrix for the current Expiration column. Execute against a disposable local database with this branch's migrations. Never run the destructive fixtures or injected failures against an existing development, staging, or production database.

## Invariants

- Only rows with a valid explicit expiration at or before the cleanup run's cutoff can be deleted.
- Empty, missing, invalid, future, delete-locked, archived, and non-Expiration data survive.
- Committed deadline extensions and clears take effect; a failed edit cannot silently change the stored deadline.
- A failed transaction deletes no partial batch. Previously committed batches remain committed.
- A table-level cleanup error skips that table for the rest of the run, is logged, and leaves other tables eligible for cleanup. Failed attempts count toward the 100-batch limit; later runs rediscover the failed table.
- A subsequent run starts from the beginning: limits, cancellation, locked rows, connection loss, and process restarts cannot permanently strand an otherwise eligible row.
- Numeric offsets identify instants and remain stored with their original clock time; Z is stored as -00:00. Equivalent instants compare equally even when their stored strings differ, with microseconds preserved.
- Cleanup obeys tenant scope, table locks, batch row limits, snapshot byte limits, and the 100-batch run limit.
- Counts and change signals describe committed deletions. Delete-trigger delivery is evaluated separately from deletion durability.

## Matrix

| ID | Scenario | Required observation |
|---|---|---|
| H01 | Create an Expiration column in Chrome | Correct picker, stored numeric offset label, one-column limit |
| H02 | Typed Z, positive/negative/zero offsets, fractional offsets | Supplied clock/offset retained; Z becomes -00:00; equivalent instants compare equally |
| H03 | Calendar date and time selection; day only; clear | Existing offset retained; day only is midnight in that offset; new values default to -00:00; clear disables expiration |
| H04 | Inline editing, row modal, paste, refresh | Same value persists and displays |
| H05 | API insert, batch insert, update, bulk update, upsert | Valid explicit instants accepted consistently |
| H06 | Omitted field on update versus explicit null | Preserve versus clear |
| H07 | Filter equality/membership/ranges; sort | Equivalent instants match; chronological ordering |
| H08 | CSV import and export/reimport | Values preserve instants and precision; rejected-cell counts visible |
| H09 | Rename/retype/remove Expiration column | Stable IDs survive rename; retyping/removing stops expiration |
| H10 | Manual cron invocation with correct secret | Queue dispatch, job completion, expired rows removed |
| H11 | Delete-trigger event and UI refresh | Only committed deleted-row snapshots emitted; live table refreshes |
| D01 | Missing/wrong cron authorization | Refused before queue or data access |
| D02 | Feature disabled at ingress or worker start | No new Expiration column and no cleanup; existing data readable |
| D03 | Second Expiration column through UI/API/retype | Refused without schema mutation |
| D04 | No session, read-only member, unrelated workspace | Auth/permission denial; no data mutation or disclosure |
| D05 | Schema, insert, update, and delete locks | Each relevant operation refused; cleanup honors delete lock |
| D06 | Invalid calendar day/leap day/time/offset/precision/type | Refused or blanked according to the documented surface policy; never guessed |
| D07 | Invalid filter operands | Validation error rather than database cast failure |
| D08 | Required Expiration and invalid type conversion | Missing values/incompatible existing cells prevent mutation |
| D09 | Unique insert, batch, replacement, and enabling unique on existing data | Equivalent instants in different offsets are duplicates; one-microsecond differences remain distinct |
| E01 | No tables; empty table | Successful no-op |
| E02 | Table without Expiration; ordinary date named expires_at | No deletion |
| E03 | Missing cell, null, empty string, malformed stored data | Survive without preventing valid rows from cleanup |
| E04 | All deadlines future | Successful no-op |
| T01 | Exactly cutoff, one microsecond before and after | Before/equal delete; after survives |
| T02 | DST overlap offsets, leap years, month/year crossover | Match PostgreSQL's instant comparison |
| T03 | Years 0001/9999 and offset-driven year boundaries | Valid supported instants preserved; unsupported inputs refused |
| T04 | Non-UTC database session and changed browser timezone | No change to deletion instant |
| T05 | Row ages differ from expiration order | Creation time controls traversal only |
| T06 | Deadline passes during a run | Fixed cutoff preserves it until the next run |
| V01 | More than 100 batches in one table | Exact first-pass capacity deleted; remainder survives then deletes next pass |
| V02 | More than 100 expiring tables | Unselected tables survive first pass then receive service |
| V03 | Large table plus many small tables | Every selected table gets a batch before a backlog gets another |
| V04 | One million small rows | Bounded runs; complete drainage; zero future/null-row loss; timings recorded |
| V05 | Wide rows cross the 32 MiB snapshot budget | Byte-limited batches keep progressing |
| V06 | Single oversized stored row | Isolated batch makes progress; following rows are reachable |
| V07 | Identical and microsecond-different creation timestamps | Cursor never omits or repeats rows |
| C01 | Row held by another transaction | Skipped now, deleted after lock release on a later pass |
| C02 | Deadline extended or cleared while row locked | New committed deadline respected on later pass |
| C03 | Delete lock/schema/archive changes after discovery | Fresh table state prevents stale deletion decisions |
| C04 | Two cleanup runs compete | Row locks prevent duplicate deletion; counts agree with database |
| C05 | Rows inserted behind the current cursor | Next run discovers them |
| F01 | Database error before first deletion | No rows lost; retry works |
| F02 | Database error after a committed batch | Partial progress correct; later pass drains the remainder |
| F03 | Connection killed during DELETE transaction | Transaction rolls back; reconnect and later pass succeed |
| F04 | Commit succeeds but caller loses response | Retry is idempotent against already-deleted rows |
| F05 | Abort before work and between batches | No premature work; later run resumes all remaining rows |
| F06 | Broken table among healthy tables | Skip the failed table, continue healthy tables in the same run, log the error, and rediscover the failed table on a later run |
| F07 | Cron queue initialization/enqueue failure | 500 response; no false success; subsequent request works |
| F08 | Repeated cron request in one window; next window | Stable deduplication key, then new key and new work |
| F09 | Browser loses server during save | Error/rollback observable; refresh agrees with committed database state |
| F10 | API client drops connection while cron is executing | Work's durable state remains discoverable; next invocation is safe |
| F11 | Process interruption/restart after partial cleanup | Completed rows stay deleted; remaining rows eligible on next run |
| F12 | Notification/trigger delivery failure | Deletion remains committed; document actual delivery guarantees |

## Evidence

The results below distinguish automated coverage from live browser, HTTP, and PostgreSQL evidence. Unit tests alone do not establish network recovery or database locking.

## Results — September 9, 2026

**Offset-preservation follow-up: 2,162 regression tests and 23 non-stress PostgreSQL scenarios pass.** The current contract preserves numeric offsets and spells incoming Z as -00:00. Earlier results below were collected before this formatting change; the follow-up section records the new contract checks. Production-environment verification is still separate.

The environment was Chrome plus this worktree's local Next.js application, PostgreSQL 17, and a freshly migrated database named `expiration_qa`. All accounts, keys, tables, and rows were disposable fixtures. Existing application environments were not used. External provider credentials were cleared in the test process. The queue used the real database backend; Trigger.dev and Redis were not configured.

### Executed results

| Area | Observed result | Evidence |
|---|---|---|
| Initial regression suite | **2,134 passed**, 1 optional PostgreSQL test skipped, across 158 files | Table domain, internal/public routes, table UI, timezone utilities, cleanup, cron |
| Initial real PostgreSQL integration | **19 scenarios passed** in the expanded run; million-row run passed separately | Actual worker, transactions, advisory locks, row locks, schema reads, count triggers; only feature lookup and post-delete signal/trigger callbacks mocked |
| Public HTTP API | **32 checks passed** | Actual API-key authentication, strict invalid timestamp refusal, insert/batch/upsert/bulk update, atomic rejection of mixed valid/invalid batch, offset equality/membership/ranges, sort, second-column and retype guards |
| First-party HTTP API | **51 checks passed** | Actual session authentication, stable-ID writes, coercion, omission versus null, required constraint, rename, all four locks, scope mismatch, unauthenticated requests, invalid filters, cron authorization |
| Chrome | Passed observed flows | Create Expiration; second Expiration disabled; typed offset with six fraction digits; reload persistence; impossible-date error; UTC day/time picker; clear; outage rollback; recovered value |
| CSV | Passed import and round trip | Four imported rows; two invalid cells reported and left blank. Export/reimport/reexport preserved six rows exactly using `Asia/Kathmandu` for reimport, after original import used `America/Los_Angeles` |
| Real cron before the driver patch | Passed failure recording, deduplication, and next-window recovery | All 3 rows survived the interrupted transaction. Repeat in the same window returned the same failed-job ID. The next window created a new job and removed all 3 |
| Abrupt worker termination | Passed commit/rollback and restart | 81 rows committed before interruption; final row remained after `SIGKILL` during its transaction; restarted CLI worker deleted exactly 1 |
| Lost HTTP response | Tested both sides of the commit boundary | Immediate client disconnect left the old value. A disconnect during a paused update allowed the transaction to finish; a later read showed the intended normalized instant. A missing response cannot be treated as proof that a save failed |
| Unrelated user | Passed | Newly created user without workspace access received 404 for the fixture table |
| Read-only member | **24 HTTP checks passed** | Four reader operations allowed; 15 mutations returned 403; four admin snapshot reads confirmed unchanged table and rows; removing the temporary grant immediately restored 404 on read |
| Static checks | Passed | TypeScript `tsc --noEmit`, Biome on the four files added/changed by this testing task, API validation audit, `git diff --check` |

The initial PostgreSQL integration suite contained 21 expanded scenarios. The follow-up below adds table failure isolation, bringing it to 22. Before the driver patch, the connection-loss scenario's row assertions passed but its run reported **two uncaught driver exceptions**. That historical run was a failure; the shipping verification below records the subsequent clean run.

### Scale and boundary measurements

- **8,101 expired rows:** one run deleted exactly **8,100** in **100 batches**; the remaining row survived until the next run and was then deleted. The current production snapshot calculation gives **81 rows per batch**.
- **101 expiring tables:** first pass removed 100 rows, second pass removed the remaining row.
- **1,001 expiring tables:** drained in **11 bounded passes**.
- **One million expired rows:** drained in **124 passes**; a future-expiration sentinel and a null-expiration sentinel both survived. Cleanup took **67.1 seconds**, excluding fixture insertion, with approximately **264 MiB** peak sampled process RSS in that run. This is local measurement, not a production throughput guarantee.
- **Large backlog plus 20 small tables:** every small table received service before the large table's second batch.
- **Wide stored rows:** 33 MiB, 17 MiB, and 17 MiB snapshots each progressed in separate batches. These deliberately bypassed ordinary row-size admission to test legacy/corrupt stored data.
- **Cutoff precision:** rows before and exactly at the cutoff deleted; rows **one microsecond later** survived, including equivalent offset spellings.
- **668 timestamp samples:** normalization agreed with PostgreSQL across early years, century/leap-year boundaries, offset extremes, and microsecond precision.
- **Concurrency:** locked rows revisited next pass; committed extension/null respected; delete lock, archive, and removal of Expiration after the first batch prevented later deletion; two simultaneous workers produced no duplicate deletions or snapshots.
- **Traversal:** identical creation timestamps, microsecond creation timestamps, a newly inserted row behind the cursor, and a deadline passing during the run all behaved correctly. Each run uses a fixed cutoff; later runs restart traversal.

### Defect fixed during testing

Adding a second Expiration column through the internal columns endpoint returned a generic **500**. The domain correctly raised a typed validation error, but the route only recognized selected message substrings. The POST error path now uses the existing shared `orchestrationErrorResponse` helper. The real endpoint returns **400** with `A table can have at most 1 Expiration column`. Two regression cases cover the column limit and disabled-feature validation errors. A clean server restart was used to verify the final response after development hot-reload class identity drift.

### Table failure isolation and database-client diagnosis — September 9 follow-up

Cleanup now catches a table's batch error, logs the table/workspace and its already committed deletion count, and skips that table for the remainder of the run. Healthy tables continue taking turns. The failed attempt consumes one of the 100 batch slots, preventing repeated errors from defeating the work limit. Completion logs include `failedTables`; the existing returned result shape is unchanged. A new run starts with fresh discovery and no retained cursor, so a skipped table can recover. Discovery errors still reject the job because no table list is available.

Verified against real PostgreSQL: the first table in discovery order was forced to fail every deletion, while a healthy table held 82 expired rows. The run retained all 3 rows in the broken table and deleted all 82 healthy rows across two deletion batches. A second run attempted the broken table once and retained its rows. After removing the fault, the following run deleted exactly those 3 rows. A separate injected failure after an 81-row committed batch preserved that commit, rolled back the following batch, and recovered the remaining 81 rows after repair. Row-count metadata stayed consistent.

Follow-up validation:

- **21 unit/cron tests passed**, with one optional PostgreSQL test skipped. Coverage includes first-table failure, continued healthy work, later-batch failure after a commit, fresh retry discovery/cursor, failure logging, batch-budget accounting, and discovery failure.
- **20 real PostgreSQL scenarios passed** in 6.64 seconds, including the new failure isolation case, 8,101-row overflow/recovery, 1,001 tables, concurrency, locks, cutoff precision, and large snapshots. The previously measured million-row scenario was not rerun for this change.
- **The separate connection-loss run before the shared driver patch was red:** its cleanup-result, rollback, and recovery assertions passed, but Vitest reported two uncaught driver exceptions and exited with status 1.
- TypeScript, Biome on the three cleanup files, API validation audit, and `git diff --check` passed.

The connection defect was also reproduced using **only the unpatched `postgres` 3.4.9 client and Node.js 22.23.1**. Two direct clients used `max: 1`, `prepare: false`, and `fetch_types: false`. One opened a transaction and ran `SELECT pg_sleep(10)`; the other called `pg_terminate_backend` on that transaction's backend. The transaction promise rejected with `CONNECTION_CLOSED`, then the driver's deferred `nextWrite` callback threw `TypeError: Cannot read properties of null (reading 'write')` at `postgres/src/connection.js:255`, terminating the standalone process with status 1. The diagnostic used no Expiration logic, table schema, Drizzle, Sim database instrumentation, or application server.

This established a **shared database-driver reliability issue**. `packages/db/db.ts` builds the main, replica, and workload pools with the same driver. Other transactions using that driver may encounter the same interrupted-connection path; their individual flows have not all been fault-injected. The feature's per-table catch handles the rejected operation, but cannot catch a later exception thrown outside that promise in the driver's deferred callback. The shared driver correction subsequently arrived through the staging base, as described next; this feature diff contains no dependency patch or upgrade.

### Shipping verification on the updated staging base

Staging already includes `patches/postgres@3.4.9.patch`, which rejects queries from a transaction scope after its connection closes. After installing the locked dependencies with that patch:

- **All 21 non-stress PostgreSQL scenarios passed**, including interrupted deletion, rollback, and subsequent cleanup, with no uncaught exceptions. The million-row scenario was excluded from this repeat; its earlier successful measurement remains above.
- **2,153 regression tests passed** across 159 test files; 30 tests were skipped in that run. PostgreSQL coverage was executed separately as described above.
- **All 46 repository audits passed**, along with repository lint, the block-registry check, docs-manifest parity, and companion tool-catalog parity.
- The companion Copilot Go suites passed in both encrypted-runtime and canonical-prompt modes. Generated catalog changes affect descriptions only; tool parameter structure is unchanged.

The standalone diagnostic no longer produced the deferred null-socket exception. Its first recovery query received a catchable PostgreSQL `57P01` disconnect error, and the next query succeeded; both clients closed cleanly. Callers must still handle ordinary database operation failures. The original script assumed that first recovery query would succeed and therefore still exited nonzero; a diagnostic that recorded the rejected query and attempted the following read completed normally. No blanket retry of application mutations was added.

### Offset-preservation follow-up

Expiration writes retain the supplied clock and numeric offset, including -07:00, -08:00, +05:45, +00:00, and -00:00. Z/z becomes -00:00; seconds and fractional-zero trimming remain canonical, with up to six fractional digits preserved. Existing Z values render/export as -00:00. Previously discarded original offsets cannot be reconstructed from UTC values.

Both editors show and retain the stored offset, independent of profile timezone loading or changes. New picker values use -00:00. The date picker uses midnight and Today in the value's fixed offset. Editing a date does not infer a daylight-saving offset change.

Equality, membership, upsert matching, and uniqueness checks compare instants rather than stored strings. Database equality guards malformed legacy values before casting; null comparison retains its existing behavior. Replacement-batch validation rejects duplicate instants before deleting existing rows, and enabling uniqueness rejects existing equivalent-offset duplicates. Sorting, ranges, and cleanup continue to use timestamp comparisons.

- **2,162 regression tests passed**, with 30 skipped, across the table domain, routes, editors, imports, timezone utilities, and cleanup. Coverage includes picker changes in five offsets, legacy Z editing, strict validation, and microsecond-aware equality.
- **23 non-stress PostgreSQL scenarios passed**, including equivalent-offset equality/membership, malformed legacy cells, batch and existing-row uniqueness, atomic replacement refusal, unique-toggle refusal, and adjacent microseconds. Existing limit, locking, rollback, failure-isolation, and connection-loss scenarios pass. The million-row measurement above was not repeated for this change.
- **17 live HTTP checks passed**: stored and returned offsets, zero-offset spellings, equivalent eq/ne/in/nin, chronological range, uniqueness refusal, omitted-expiration preservation, and real cron dispatch. A subsequent read confirmed only the expired fixture was removed; all seven future/null fixtures survived.
- **CSV export passed:** all seven surviving values retained their numeric offsets and fractional precision.
- **Chrome visual recheck incomplete:** sign-in succeeded on an isolated loopback origin, but the automation connection repeatedly timed out during table navigation; the native-control fallback also failed. No new visual acceptance is claimed. Inline-picker and row-modal behavior is covered by the automated tests above.
- Repository lint, type checking, all **46 audits**, generator parity, and companion Go tests in encrypted-runtime and canonical-prompt modes passed. The required eight UI cleanup passes found no issues.

### Unresolved findings and operational limits

1. **Initial million-row timeout.** The first million-row run exceeded the existing database statement timeout. A fresh isolated repeat drained all million rows successfully. A query plan captured during the repeat used the existing creation-time index and primary-key lookup. The initial timeout's root cause remains unproven; the successful repeat does not erase it. An earlier export connection timeout also recovered on retry; its relationship to the historical driver exception remains unproven.
2. **Delete triggers are best effort.** Deletion commits before workflow-trigger delivery, and the trigger helper logs delivery failures without throwing. A crash between commit and delivery can lose a notification. There is no transactional outbox or demonstrated exactly-once delivery guarantee. Database deletion durability and trigger delivery must not be conflated.
3. **Limits defer work deliberately.** Cleanup is periodic, and a failed job has one attempt within its schedule window. A repeated HTTP invocation in that window does not bypass deduplication. Limits, failed tables, and locked rows can postpone cleanup until another window. A table that continues failing needs its underlying problem repaired before its rows can drain.

### Coverage distinctions and remaining gates

| Matrix coverage | Status |
|---|---|
| H01–H03, H05–H08, H10; D01, D03, D05–D08; E01–E04; T01–T03, T05–T06; V01–V07; C01–C05; F01–F05, F07–F11 | Exercised through the combination of real HTTP/browser/PostgreSQL runs and the regression suite described above. F03 now passes with the inherited driver patch; the first V04 attempt timed out |
| H04: inline editor, persistence | Live Chrome passed; row-modal and paste behavior covered by automated tests, not an additional live Chrome interaction |
| H09: rename/retype/remove | Rename verified over HTTP; second-TTL retype denied over public HTTP; removal during cleanup verified with real transactions. Conversion details covered by regression tests |
| H11 / F12: refresh and delivery | Chrome received live CSV changes. Real integration verified committed snapshot counts, and trigger tests ran in the regression suite. No external workflow was launched; cross-process live deletion refresh was not certified without Redis/realtime |
| D02: feature flag | Worker-disable and route ingress refusal covered automatically. The unrelated v2-query flag was also observed refusing real HTTP access while disabled. No production flag was toggled |
| D04: read-only member | Verified live. Table, row, individual-row, and expiration-query reads succeeded. Table creation; single/batch insertion; expiration change/clear; batch update; upsert; single/batch deletion; column addition/retype/removal; table rename; lock changes; and table deletion all returned 403. Admin snapshots confirmed no mutation. The temporary grant was removed, and the reader then received 404 |
| T04: timezone | CSV round trip across two different timezone arguments and explicit-offset comparisons passed. Host/browser timezone was not changed; full OS timezone switching remains unexecuted |
| F06: broken table among healthy tables | Passed with real PostgreSQL fault injection: broken first table retained, healthy table drained in the same run, repeated failure attempted only once per run, repair followed by successful cleanup |
| Production queue/backend | Trigger.dev scheduling, Redis/realtime distribution, deployed worker restarts, and production database/pool topology require a separate environment run |

### Reproduction

The new integration test is `apps/sim/background/cleanup-table-row-ttl.integration.test.ts`. It refuses non-local databases, requires the database name `expiration_qa`, and rejects conflicting database URLs. Use a disposable database with the repository's complete migrations; do not point it at ordinary development data. It deletes its generated fixture workspace in teardown. Fault-injection tests create temporary trigger functions in that disposable database.

From `apps/sim`, with a sanitized test environment and both database URL variables pointing to the disposable local database:

```sh
TABLE_TTL_TEST_DATABASE_URL="$LOCAL_TEST_DATABASE_URL" \
DATABASE_URL="$LOCAL_TEST_DATABASE_URL" \
TABLE_TTL_QA_STRESS_ROWS=1000000 \
bunx vitest run background/cleanup-table-row-ttl.integration.test.ts
```

Set `LOCAL_TEST_DATABASE_URL` to a disposable local database named `expiration_qa` and install the repository's locked dependencies so its driver patch is applied. Without `TABLE_TTL_TEST_DATABASE_URL`, the integration scenarios skip. Without `TABLE_TTL_QA_STRESS_ROWS`, the million-row scenario skips. Post-delete workflow delivery is mocked in this suite; use the real HTTP cron exercise for queue/job evidence.

Other checks executed:

```sh
bunx vitest run lib/table app/api/table app/api/v2/tables \
  background/cleanup-table-row-ttl.test.ts \
  app/api/cron/cleanup-table-row-ttl/route.test.ts \
  'app/workspace/[workspaceId]/tables' lib/core/utils/timezone.test.ts
bun run type-check
```

From the repository root, `bun run check:api-validation` also passed.

Execution logs and disposable CLI harnesses are retained locally. No generated credentials are committed to the repository. All injected database triggers and the temporary read-only permission grant were removed, and generated integration-test workspaces were deleted. The small browser/API fixtures and local database are retained on disk for inspection; the disposable app and database servers are stopped after verification.
