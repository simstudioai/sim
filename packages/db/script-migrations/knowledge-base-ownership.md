# Knowledge base ownership

Every retained KB, including soft-deleted KBs, has exactly one resource owner:

- A normal KB has `workspace_id` set and `organization_id` null.
- An organization Search index has `organization_id` set, `workspace_id` null, and `is_search_index` true. The existing organization indexes enforce one active Search index per organization; workspace KB catalogs do not expose it.

The KB's historical `user_id` is retained as creator/compatibility metadata; it does not determine current authorization or billing. Current workspace permissions or organization membership authorize operations. The workspace billing account or organization is the payer; the authenticated human remains the actor. Background indexing retains its explicit system billing snapshot and never grants document access from billing identity.

## Deployment order

SQL migration `0331` adds the organization Search check without scanning the KB table. The migration runner then runs registered script `0014` after `0013`:

1. Reuse the existing keyset backfill and per-KB transaction, including soft-deleted KBs. Keep their deletion timestamps and names. Prefer an active eligible workspace; an archived KB with no active destination may remain with an archived workspace. Existing reference/activity rules choose among destinations. No new workspaces or organizations are created.
2. Reconcile the destination workspace and affected payer storage ledgers atomically with each move. Retained archived documents remain accounted for; no documents or files are purged.
3. Refuse completion if any KB has unresolved or conflicting ownership. Such rows require manual repair; rerunning resumes from the remaining unscoped rows.
4. Replace the permissive owner check with `num_nonnulls(workspace_id, organization_id) = 1` in a short transaction, after repair. Validate both checks in a separate transaction. New application code is rolled out only after the registered script succeeds.

Deployed creation and move paths already require ownership. Repairing before tightening the check also preserves old-app restoration of archived rows during migration. The new app removes creator-authorized personal KB reads, restores, uploads, moves, and billing fallbacks. Parsers for previously queued processing and cleanup events remain compatible; a stale processing snapshot cannot charge a different resource scope.

## Performance

The existing organization foreign key and lookup/name/Search indexes are reused. No index rebuild, table rewrite, or extra join is added to Search. The owner and Search checks perform constant work per KB insert/update. Validation scans `knowledge_base` under PostgreSQL's `SHARE UPDATE EXCLUSIVE` lock, allowing ordinary reads and writes, with bounded lock and statement timeouts ([PostgreSQL documentation](https://www.postgresql.org/docs/17/sql-altertable.html)). Backfill reads IDs in batches of 100 and commits each KB independently; document byte totals are aggregated in PostgreSQL.

Workspace listings lose the extra legacy personal-KB query and in-memory merge sort; processing drops the workspace join previously used only for fallback attribution.
