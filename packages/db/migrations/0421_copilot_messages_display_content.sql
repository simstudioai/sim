ALTER TABLE "copilot_messages" ADD COLUMN "display_content" jsonb;--> statement-breakpoint
-- A write that replaces `content` without writing `display_content` (a release that predates
-- the column, during a blue/green cutover or after a rollback) would leave the UI reading the
-- old projection. Clearing it falls back to `content`, which is always current. Writers that
-- know the column set both, so the WHEN guard keeps the function off their path whenever the
-- projection changes with the content.
-- contract-pending(after this release is fully deployed and no older release can be rolled back to): drop trigger copilot_messages_clear_stale_display_content and its function — only writers that predate display_content need it.
CREATE OR REPLACE FUNCTION copilot_messages_clear_stale_display_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.display_content := NULL;
	RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS copilot_messages_clear_stale_display_content ON copilot_messages;--> statement-breakpoint
CREATE TRIGGER copilot_messages_clear_stale_display_content
BEFORE UPDATE OF content ON copilot_messages
FOR EACH ROW
WHEN (
	NEW.display_content IS NOT DISTINCT FROM OLD.display_content
	AND NEW.content IS DISTINCT FROM OLD.content
)
EXECUTE FUNCTION copilot_messages_clear_stale_display_content();
