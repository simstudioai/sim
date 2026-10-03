# Server-side collaborative documents

This module converts workspace Markdown files to and from the shared TipTap/Yjs document.
Markdown is the durable file content; the persisted Yjs binary retains the causal identities and
deletion history needed to reconnect existing clients. Equal Markdown does not imply equal history.

## Persistence and seeding

- Convert with the same editor extensions and Markdown pipeline used by the client.
- Preserve native Yjs snapshots. Normalize the Markdown projection, not a detached shared tree:
  deleting an empty paragraph in a saved snapshot can delete text a disconnected peer types there later.
- Persist the relay's native full snapshot. Reject a different document identity; stale content
  writes also require a throwaway merge proving that the candidate does not omit durable content.
- Commit the prepared binary and Markdown pointer in the same file-row transaction. The content
  version and exact cached binary/source hashes must still match their preparation inputs.
- Cache-only saves and seeds use the same file-row lock and revision check. Unchanged snapshots
  validate their revision without rewriting the row. Simultaneous cold seeds adopt the winning identity.
- Keep conversion and blob I/O outside the transaction. Bound loaded and prepared binary states to
  12 MiB; oversized or unavailable cache reads fail rather than masquerading as an absent document.
- Retry content/cache conflicts a bounded number of times from fresh reads. Infrastructure errors
  propagate so callers can retry without acknowledging an uncommitted snapshot.

External Markdown writes reconcile through `applyMarkdownToYDoc`, using the existing
`updateYFragment` binding. Equivalent normalized bodies leave the native tree untouched; actual
content changes apply a diff. This preserves unaffected identities, but is not a guarantee that
arbitrary structural rewrites retain every concurrent edit.

## Compatibility and limits

All cache writers must use the shared transaction/revision protocol. Drain older application writers
before relying on its guarantees; an old unconditional writer does not participate in the fence.
This change does not alter the document schema or migrate existing documents.

Legacy caches can contain private normalization deletions that the live relay never received.
Unconditionally merging those caches into snapshots can delete delayed edits or prevent saving.
The relay remains the snapshot owner, as before; this change does not solve retention of extra
cache-only operations invisible in Markdown. Safely unifying all historical state requires an
explicit legacy compatibility plan, not a hash check or a guess at deletion provenance.

Native nested-list reparenting can lose concurrent edits to moved content in the current binding.
A stable-parent list representation requires a separately tested schema and offline-update migration;
rebuilding a Y.Doc or changing its identity is not a safe migration.

Conversion is server-side and uses a lazily initialized jsdom window for TipTap. It must not enter
a client bundle.

## Precedent

- [Yjs document updates](https://docs.yjs.dev/api/document-updates): native update merging and encoded state.
- [Hocuspocus persistence](https://tiptap.dev/docs/hocuspocus/guides/persistence): preserve Yjs binary
  rather than recreating it from JSON on reconnect.
- [PostgreSQL row locking](https://www.postgresql.org/docs/current/explicit-locking.html): serialize
  conflicting commits under the existing file-row lock.

The repository tests cover conversion, native-history preservation, cache conflicts, seed races,
and file-manager transaction wiring. Real PostgreSQL concurrency and live collaboration require
integration validation in addition to those unit tests.
