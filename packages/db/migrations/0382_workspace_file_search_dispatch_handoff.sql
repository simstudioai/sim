-- The deadline for a dispatch claim's run to be handed off. Nullable with no default, so adding it
-- rewrites no rows: the table lock is taken under the runner's lock timeout and released when the
-- migration batch commits. NULL keeps the existing stale-dispatch recovery, which is what claims from
-- the still-deployed dispatcher need until the new worker version is promoted.
ALTER TABLE "workspace_file_search_revision" ADD COLUMN "handoff_expires_at" timestamp;
