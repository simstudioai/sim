# Knowledge document storage accounting

Regular uploads charge their workspace and its canonical payer in the document transaction. Source-connected documents are not metered as uploaded storage. Disconnecting a workspace-mode source while keeping its documents now converts that ownership and charges the retained bytes in the same transaction. A quota failure leaves the source and documents attached.

The detachment transaction locks the knowledge base, connector, then workspace and payer ledgers in the same order as source writes and upload/deletion paths. A SQL aggregate counts retained bytes without materializing the source. It includes archived files still retained and resurrected source tombstones, excludes archived tombstones, and repairs legacy skipped placeholders whose empty file URL and absent storage key prove that no artifact was stored. Delete-with-source pages 250 documents at a time and records durable backing-file cleanup inside the transaction, including archived documents.

Hard deletion uses the fields returned by `DELETE`, so accounting and cleanup operate on the actual deleted source revision. Concurrent duplicate deletion cannot debit twice. Rows already tombstoned are excluded consistently with storage reconciliation.

## Repairing existing drift after deployment

The code prevents new missing charges. Existing counters need the repository's existing bounded online reconciliation after the updated app and workers are deployed and old instances are drained. Use a write-capable migration connection supplied by the deployment environment.

From `packages/db`, run:

```sh
WORKSPACE_STORAGE_RECONCILE_ACK=old-apps-drained bun run db:reconcile-workspace-storage
```

The command uses `MIGRATION_DATABASE_URL` (or `DATABASE_URL`), visits workspaces in 250-row keyset pages, rebuilds totals from canonical retained-file/document metadata, and then reconciles one organization/user payer at a time. It is idempotent and does not fetch object contents. It fails on invalid canonical file sizes instead of guessing or silently clamping a reconstructed balance. Do not run while old application instances can still omit storage adjustments.

The real Postgres integration tests cover ordinary uploads, concurrent detachment and duplicate deletion, quota rollback, 501-document source deletion, archived and skipped files, and replay of the repair command against deliberately drifted local fixtures. No production counters are changed by the tests or this PR.
