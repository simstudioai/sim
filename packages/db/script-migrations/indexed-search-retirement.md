# Indexed Search database retirement

This inventory separates retired enterprise Search indexing from the database objects that still
serve ordinary knowledge bases and live Search. Removing an application reader does not remove an
installed PostgreSQL trigger or reclaim its table. This release removes legacy application paths;
physical removal must follow a fully deployed release boundary.

No step in this document authorizes an unbounded data deletion, automatic HNSW rebuild, or production
execution. The existing Search retirement command remains operator-run maintenance. Its progress and
target snapshot must survive until a replacement cleanup has adopted them or retirement is verified.

## Deferred physical removal

| Object | Retired responsibility | Contract prerequisite |
| --- | --- | --- |
| `embedding_keyword_search` and its foreign key, primary key, `embedding_keyword_search_kb_idx`, `embedding_keyword_search_document_idx`, `embedding_keyword_search_content_idx` | Indexed Search's GIN keyword candidate projection | Remove indexed readers and all keyword projection writers, including older workers and database triggers. Ordinary KB keyword ranking uses `embedding.content_tsv`. |
| `embedding_keyword_tin` and its foreign key, primary key, `embedding_keyword_tin_document_idx`, `embedding_keyword_tin_content_idx`, `embedding_keyword_tin_acl_gin_idx`, `embedding_keyword_tin_acl_unfilled_idx` | Indexed Search's optional Tin/BM25 projection and permission copies | Remove indexed readers, Tin/ACL projection writers, and maintenance references. Some installations never installed the optional Tin index. |
| `embedding_search.connector_id`, `embedding_search.acl` | Denormalized per-vector source/permission filtering for indexed Search | Deploy removal of indexed readers, then retire source/ACL triggers and old projector/detachment writers. Regular KB retrieval must keep checking the parent document. |
| `embedding_search_source_idx`, `embedding_search_acl_gin_idx`, `embedding_search_acl_unfilled_idx` | Source filtering, copied ACL overlap, and ACL backfill probes | Remove indexed readers and ACL fill paths; drop indexes concurrently in a later contract migration. These indexes were created by script migrations and are not declared in `schema.ts`. |
| `embedding_search_src_*` partial HNSW indexes | Per-connector ANN graphs used only by indexed Search | Inventory actual index definitions, confirm each belongs to `embedding_search` and filters a retired source, then drop concurrently. Preserve the shared width-specific HNSW indexes. |
| `organization_search_invocation`, its two foreign keys, bounds checks and `organization_search_invocation_org_created_idx` / `organization_search_invocation_user_idx` | Indexed result activity counters and old organization statistics | Deploy removal of the indexed statistics API and activity writer, and drain old application versions. |
| `embedding_search.binary`, `binary_384`, `binary_768`, `binary_1024`, `binary_3072` | Obsolete binary-quantized candidate representation | Stop `sync_embedding_search()` and the recovery projector from calculating/writing these columns, and replace the binary-based `embedding_search_width_check`. The five binary ANN indexes were already removed in migration `0372`. |
| `knowledge_projection_dirty`, its document FK/primary key, and `knowledge_projection_dirty_marked_at_idx` | Tracks copied source/ACL changes and older deferred vector writes | First complete or adopt every pending vector content repair, stop mark writers, and drain old workers. A `content = true` mark can represent a missing ordinary-KB vector; discarding it can lose retrieval coverage. |
| `search_embedding_cleanup_progress`, `search_embedding_cleanup_targets` | Durable retirement scope, cursor, and maintenance checkpoints | Complete and verify retirement, or explicitly adopt this state into a successor. These script-owned tables are not application schema objects and must not be dropped merely because deployment no longer runs cleanup. |

The binary-width constraint currently requires exactly one populated binary column. Stopping binary
writes without changing that constraint would reject new ordinary-KB vectors. A replacement vector
table can omit the binary columns and use an appropriate vector-width invariant from the outset.
Changing the existing table requires a separately reviewed compatible transition; no table-wide
rewrite or validation scan belongs in this application-removal release.

## Installed triggers and functions

These live in the database after their TypeScript installer has finished. Deleting an installer or
an application import alone leaves its database work active.

| Retire after dependent old code drains | Installed by |
| --- | --- |
| `embedding_keyword_search_sync` on `embedding`; `sync_embedding_keyword_search()` | `0016`, subsequently scoped/guarded by `0024` and `0025` |
| `knowledge_base_keyword_search_sync` on `knowledge_base`; `sync_knowledge_base_keyword_search()` | `0025` |
| `embedding_keyword_tin_sync` on `embedding`; `sync_embedding_keyword_tin()` | `0019`, subsequently guarded/scoped by `0024` and `0025` |
| `knowledge_base_keyword_tin_sync` on `knowledge_base`; `sync_knowledge_base_keyword_tin()` | `0019`, updated by `0025` |
| `knowledge_tin_stream(tsvector)`, `knowledge_tin_base_token(text)`, `knowledge_tin_membership_key(text)` | `0019`; the membership helper is also installed by `0025` and used by both keyword writers and the projector |
| `projection_source_acl_sync` on `document`; `sync_projection_source_acl()` | `0021`/`0022`, updated by `0023`, `0024`, and `0025` |
| `embedding_search_source_acl_set` on `embedding_search`; `embedding_keyword_tin_source_acl_set` on `embedding_keyword_tin`; `set_projection_source_acl()` | `0021`/`0022`, guarded by `0024` |
| `embedding_projection_mark_insert`, `embedding_projection_mark_update` on `embedding`; `mark_inserted_embedding_projection()`, `mark_updated_embedding_projection()`, `mark_knowledge_projection(text[], boolean)` | `0024`; remove only after vector-repair adoption/drain |

Very old installations may retain the earlier `embedding_search_connector_sync` document trigger,
`embedding_search_connector_set` projection trigger, `sync_embedding_search_connector()`, and
`set_embedding_search_connector()`. The current ACL installer removes those names; an idempotent
contract should account for installations that skipped it without using `CASCADE`.

Keep `embedding_search_sync` on `embedding` and `sync_embedding_search()` until their ordinary-KB
replacement is active. Their vector projection is shared. Their binary computations can be retired
under the constraint transition above. The `sim.projection_mode` transaction setting is also used by
existing repair workers to skip synchronous triggers, so removing that guard before those workers
drain needs separate review.

Dropping triggers requires relation locks. Use short lock timeouts and bounded retries in the
contract; a waiting DDL statement must not queue production writers indefinitely. Remove triggers
before their functions, then dependent indexes/columns/tables. Do not use broad `DROP ... CASCADE`.
The optional `tin` extension is not automatically droppable: confirm no other schema or application
uses it before scheduling extension removal.

## Application and bootstrap dependencies

The app-removal release must remove or narrow these responsibilities:

- Indexed Search retrieval, projection-fill checks, and keyword/Tin capability probes.
- Source/ACL copying and keyword projection in `packages/db/knowledge-projection.ts`; retain bounded
  repair of ordinary-KB vector content left by older asynchronous writers.
- The `knowledge-projection` background task and its enqueue/sweep path only after vector repair is
  complete or adopted. While retained, it must not recreate retired keyword data.
- `prewarmSearchProjection`: keep shared vector warming if useful, but stop warming retired keyword
  heaps and ACL GIN indexes. `pg_prewarm` itself is not specific to enterprise Search.
- Connector detachment's direct updates of copied source/ACL fields. These writes are currently paged
  to prevent document updates from causing unbounded trigger fan-out. Keep that protection until the
  database fan-out trigger has been retired, even if the new application no longer reads the copies.
- ACL-change page sizing in member observations and source permission persistence. Canonical
  document ACLs still matter; only their projection-row accounting can simplify after fan-out stops.
- Operator maintenance commands that refer to retired tables. In particular, `0028` currently lists
  both keyword tables for vacuum and discovers every HNSW index on the shared vector table. Physical
  contraction must first replace or retire this command so a retry does not target removed objects.

Historical SQL migrations remain intact. Script migrations run **after all SQL migrations**; old
pending scripts must not reinstall retired objects after a contract or fail because their target
columns have disappeared. `db:push` has its own reconciliation command list and needs the same review.

| Script migration | Treatment |
| --- | --- |
| `0015_backfill_embedding_search` | Already superseded by `0016`; historical binary projection installer, not a reason to recreate binary indexes. |
| `0016_backfill_search_vectors` and `0017_index_search_documents` | Mixed shared/retired responsibilities. They install/backfill ordinary-KB vectors and build required vector indexes as well as legacy keyword objects. Do not unregister them wholesale without a replacement shared-vector bootstrap and upgrade path. |
| `0019_tin_keyword_projection` | Entirely retired keyword projection, but its installed functions/triggers remain until contract. Supersede in a reviewed bootstrap transition. |
| `0021_embedding_search_connector`, `0022_projection_source_acl_backfill`, `0023_projection_acl_skip_unfilled` | Entirely retired projection-copy installation/indexing/backfill. `0022` already supersedes `0021`. Removing application use does not justify replaying their table-wide work. |
| `0024_knowledge_projection_async` | Mixed legacy ACL and old vector-repair machinery. Supersede only with a vector-safe replacement and pending-mark handling. |
| `0025_scope_keyword_projections` | Scopes legacy keyword writers and adjusts the document ACL trigger. It also installs the membership helper used by the old projector. Remove with the dependent machinery. |
| `0027`–`0029` Search retirement | Already absent from automatic deployment. Preserve their checkpoints until successor cleanup adoption; do not reintroduce automatic deletion, vacuum, or HNSW rebuilding. |

The current registry and `scripts/push.ts` are intentionally not changed by the inventory alone.
Simply omitting legacy installers on fresh installs is unsafe while mixed-version application paths,
repair workers, or later installers still expect their functions. A successor must define the full
final bootstrap, explicitly supersede the old script receipts, and work for empty, partially
migrated, and already-running databases without scanning all existing data during deployment.

## Shared objects that remain

- `embedding`, its full-precision vectors, content TSV/GIN index, tags, and provenance sidecar.
  Regular KB exact reranking, keyword retrieval, document filtering, and secret provenance use them.
- `embedding_search` identities, enabled state, half-precision vectors, six HNSW indexes, KB index,
  document lookup index, and embedding FK. Ordinary KB ANN retrieval uses this table. A replacement
  must preserve current inserts, updates, deletes, and document-level authorization before cutover.
- `document.acl`, `acl_requirements`, `acl_verified_at`, the ACL GIN index/shape check, `connector_id`,
  source URL/modified/seen timestamps, and source indexes. Ordinary KB reads still enforce the
  document access predicate; workspace connectors can use member/admin permissions, and ordinary
  KB filters use source modification times. Source-seen time drives connector absence reconciliation.
- `knowledge_connector_member`, `knowledge_document_observation`, external directory/group tables,
  permission snapshot/grant tables, member sync logs, and their indexes. They support ordinary KB
  permission-scoped connectors; deleting them would remove authorization evidence.
- Connector access mode, credential groups, member/admin sync state, permission/listing checkpoints,
  partitions, retry fields, and detachment billing reservations. These are shared connector machinery.
- `knowledge_base.is_search_index`, organization ownership, and Search KB uniqueness constraints.
  Live Search still loads configured sources through Search-marked KBs. A marker is also the durable
  retirement target boundary; it is not proof that the parent KB row itself can be deleted.
- `organization_search_integration`, live Search activity/OAuth structures, provider credentials, and live
  source configuration. They belong to the live product as well as the retired implementation.
- `workspace_file_search_*`, Slack Search, and documentation embeddings. These are separate search
  products and are outside this retirement.

The old `doc_processing_recovery_idx` is independently marked as superseded by the per-source
recovery index in `schema.ts`. It is a separate contract candidate after its replacement release is
verified; it is not evidence that ordinary KB processing recovery can be removed.

## Release order and completion evidence

1. Deploy removal of indexed readers/admission paths and narrow remaining shared workers. Keep the
   compatible schema and trigger protection while older web tasks, queued jobs, and rollback images
   may still use them. Retain the `contract-pending` markers in `schema.ts`.
2. Verify the release is fully deployed, old workers have drained, and rollback cannot reactivate
   indexed Search. Adopt or complete pending vector repairs before dropping their queue. Verify
   ordinary KB retrieval and permission changes against real PostgreSQL boundaries.
3. Retire legacy triggers/functions and installers with a shared-vector-safe bootstrap. Preserve
   historical migration replay and inspect unknown dependencies rather than cascading through them.
   This stops future keyword/ACL copying without rewriting existing vector rows.
4. Build any replacement projection through separately controlled, resumable maintenance. Copy only
   ordinary-KB rows, capture concurrent changes, validate retrieval/authorization, then switch readers
   while retaining a tested rollback path. This inventory does not start that copy or rebuild.
5. Contract retired tables/columns/indexes only after those readers and writers are gone. Reference
   the deployed removal release in migration safety acknowledgments and remove the corresponding
   `contract-pending` markers. Keep cleanup state until content retirement is independently verified.

Code deletion, stopped writes, copied data, a successful read cutover, and physical reclamation are
different completion conditions. Report them separately; none implies that all the others happened.
