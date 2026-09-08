# Knowledge backing-file cleanup

A document deletion, source replacement, or authoritative empty-source replacement now commits its cleanup intent in the same PostgreSQL transaction as the document change. Cleanup jobs use the shared outbox with bounded retries, rather than swallowing a storage or metadata failure after the document row is gone. Connector uploads reserve a fresh immutable metadata binding and its delayed cleanup guard together before writing any object bytes. Failed cleanup persistence prevents the upload. The object write is create-only and has a two-minute deadline, inside the guard's five-minute grace period. Attachment verifies the reserved metadata ID and content version; a successfully attached object is retained.

Each event binds the file ID, storage key, owner, and content version. Owners are the canonical workspace, organization, or explicitly supplied user for legacy personal KBs. The handler only acts on the same active metadata version, holds that row's exclusive lock during bounded, abortable object deletion, then soft-deletes metadata. A failed object deletion leaves the metadata active for retry. An ambiguous successful object deletion is safe to repeat because missing objects count as success. A restored or replacement version is retained. Document creation and active metadata registration take a shared lock on the same binding, and the cleanup handler checks the indexed `document.storage_key` before deleting; shared and concurrently attached files are retained. Personal documents may reference never-bound legacy files, but cannot reattach a key whose known metadata was deleted.

Each releasing mutation receives a fresh cleanup event ID. A previous event may have completed while another document still referenced the object, so that event must not suppress cleanup when a recreated document later releases the same unchanged object.

Upload guards also bind the provider upload ID. A crash before the write releases the unused metadata reservation; a crash after the write deletes the matching unreferenced object and reservation. A create-only conflict cannot delete an older object with a different upload ID. Metadata is not registered a second time after the write, so a late worker cannot restore a reservation already removed by cleanup.

Attachment locks its pending cleanup event before waiting for the KB or connector locks. The outbox worker skips that locked event even if its grace period expires during attachment. Commit makes the document reference visible before releasing the guard; rollback releases the guard so orphan cleanup can proceed. The existing KB, connector, and metadata lock order stays intact.

Enqueue reads and inserts at most 100 objects per batch. Each event deletes one object, has a 15-second storage deadline, uses a five-second lock timeout, and has 48 bounded outbox attempts. Exhausted jobs remain visible as dead letters with their identity and final error for operator recovery.

Comparing a `Date` against a `date_trunc(...)` SQL expression must explicitly encode the timestamp parameter. The shared metadata function binds an ISO timestamp with a PostgreSQL timestamp cast. Real PostgreSQL tests reproduce the driver encoding failure and prove deletion of a timestamp with microsecond precision.

## Previously orphaned files

Deploying the fix prevents new lost cleanup intents but does not itself delete previously orphaned objects. For a separately reviewed repair:

1. Read active `workspace_files` entries in `knowledge-base` context with `kb/` or `knowledge-base/` keys, older than a conservative grace period, using ID keyset pages of at most 100. Restrict the initial pass to confirmed orphaned metadata identities.
2. Require an unambiguous current workspace or organization owner and no `document.storage_key` reference. Migration 0222 backfilled existing KB references and installed `doc_storage_key_idx`; verify that deployment prerequisite before widening the repair beyond confirmed orphaned objects. Never infer ownership from a filename or user-supplied URL.
3. Review the bounded candidate report, then enqueue the same identity-bound cleanup events using `enqueueKnowledgeStorageCleanup`. The worker rechecks ownership, content version, and references immediately before deleting; do not issue raw bucket deletes or mark metadata deleted first.
4. Inspect the shared outbox for completed or dead-letter `knowledge.document.storage.cleanup` events. Retry only the retained failed identities after addressing their concrete error. Do not indiscriminately resurrect old completed or invalidated cleanup jobs.

A legacy object without a trusted metadata binding is deliberately not deleted by this worker. Its ownership must first be established through the existing canonical file-binding repair process.
