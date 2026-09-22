-- Resumable position of the members-mode absence reconcile, so each run checks a bounded slice of
-- the connector instead of every live document. Nullable with no default: a metadata-only change.
ALTER TABLE "knowledge_connector" ADD COLUMN "member_tombstone_cursor" jsonb;
