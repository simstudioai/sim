-- Marks a staged workspace source blob an apply has written into the workspace, so its bytes stop
-- counting toward the payer's storage quota a second time. Nullable with no default: adding it
-- rewrites no rows, and the app version already deployed neither reads nor writes it.
ALTER TABLE "workspace_source_staged_blob" ADD COLUMN "consumed_at" timestamp;
