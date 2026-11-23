-- Contracts expand/contract migrations whose readers and writers are gone from every deployed release.
-- workspace_file_search_mark_pending() is redefined first, without its legacy enqueue, so no trigger
-- writes workspace_file_search_dispatch_queue once that table is dropped. Each drop then autocommits
-- under a short lock timeout: a table drop takes ACCESS EXCLUSIVE on every FK parent, so a busy parent
-- fails fast for migrate.ts to retry rather than queue traffic behind it. organization.whitelabel_settings
-- is only un-declared here; its DROP COLUMN waits for the next release (contract-pending marker in schema.ts).
CREATE OR REPLACE FUNCTION workspace_file_search_mark_pending()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_type text; owner_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE workspace_file_search_build SET expires_at = now()
      WHERE id = (SELECT build_id FROM workspace_file_search_revision WHERE file_id = OLD.id);
    owner_type := CASE WHEN OLD.project_id IS NOT NULL THEN 'project' WHEN OLD.context IN ('workspace', 'test', 'changelog') THEN 'workspace' END;
    owner_id := coalesce(OLD.project_id, OLD.workspace_id);
    IF owner_type IN ('workspace', 'project') AND (OLD.context = owner_type OR (owner_type = 'workspace' AND OLD.context IN ('test', 'changelog'))) AND owner_id IS NOT NULL THEN
      INSERT INTO file_search_dispatch_queue (entity_type, entity_id) VALUES (owner_type, owner_id)
      ON CONFLICT (entity_type, entity_id) DO UPDATE SET updated_at = now();
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.content_updated_at, NEW.deleted_at, NEW.context, NEW.workspace_id, NEW.project_id)
      IS NOT DISTINCT FROM ROW(OLD.content_updated_at, OLD.deleted_at, OLD.context, OLD.workspace_id, OLD.project_id) THEN
      RETURN NEW;
    END IF;
    UPDATE workspace_file_search_build SET expires_at = now()
      WHERE id = (SELECT build_id FROM workspace_file_search_revision WHERE file_id = NEW.id);
    DELETE FROM workspace_file_search_revision WHERE file_id = NEW.id;
    IF ROW(NEW.context, NEW.workspace_id, NEW.project_id)
      IS DISTINCT FROM ROW(OLD.context, OLD.workspace_id, OLD.project_id) THEN
      owner_type := CASE WHEN OLD.project_id IS NOT NULL THEN 'project' WHEN OLD.context IN ('workspace', 'test', 'changelog') THEN 'workspace' END;
      owner_id := coalesce(OLD.project_id, OLD.workspace_id);
      IF owner_type IN ('workspace', 'project') AND (OLD.context = owner_type OR (owner_type = 'workspace' AND OLD.context IN ('test', 'changelog'))) AND owner_id IS NOT NULL THEN
        INSERT INTO file_search_dispatch_queue (entity_type, entity_id) VALUES (owner_type, owner_id)
          ON CONFLICT (entity_type, entity_id) DO UPDATE SET updated_at = now();
      END IF;
    END IF;
  END IF;
  owner_type := CASE WHEN NEW.project_id IS NOT NULL THEN 'project' WHEN NEW.context IN ('workspace', 'test', 'changelog') THEN 'workspace' END;
  owner_id := coalesce(NEW.project_id, NEW.workspace_id);
  IF owner_type IN ('workspace', 'project') AND (NEW.context = owner_type OR (owner_type = 'workspace' AND NEW.context IN ('test', 'changelog'))) AND owner_id IS NOT NULL THEN
    -- Waking the owner also reconciles bounded dependent builds without rewriting their sources here.
    INSERT INTO file_search_dispatch_queue (entity_type, entity_id) VALUES (owner_type, owner_id)
      ON CONFLICT (entity_type, entity_id) DO UPDATE SET updated_at = now();
    IF NEW.deleted_at IS NULL AND NEW.context = owner_type THEN
      INSERT INTO workspace_file_search_revision (file_id, workspace_id, entity_type, entity_id, source_content_updated_at)
      VALUES (NEW.id, NEW.workspace_id, owner_type, owner_id, NEW.content_updated_at)
      ON CONFLICT (file_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = '100ms';--> statement-breakpoint
-- migration-safe: contract of 0409 (shipped in v0.9.20): settings.show_training_controls and copilot_enabled_models are declared by no released schema and read by no code.
ALTER TABLE "settings" DROP COLUMN IF EXISTS "show_training_controls";--> statement-breakpoint
-- migration-safe: contract of 0409 (shipped in v0.9.20): settings.copilot_enabled_models is declared by no released schema and read by no code.
ALTER TABLE "settings" DROP COLUMN IF EXISTS "copilot_enabled_models";--> statement-breakpoint
-- migration-safe: contract of 0409 (shipped in v0.9.20): copilot_chats.plan_artifact is declared by no released schema; the plan artifact lives in the message transcript.
ALTER TABLE "copilot_chats" DROP COLUMN IF EXISTS "plan_artifact";--> statement-breakpoint
-- migration-safe: contract of 0409 (shipped in v0.9.20): copilot_messages.parent_message_id is declared by no released schema and was never read or written.
ALTER TABLE "copilot_messages" DROP COLUMN IF EXISTS "parent_message_id";--> statement-breakpoint
-- migration-safe: contract of 0409 (shipped in v0.9.20): copilot_messages.tokens_in is declared by no released schema and was never read or written.
ALTER TABLE "copilot_messages" DROP COLUMN IF EXISTS "tokens_in";--> statement-breakpoint
-- migration-safe: contract of 0409 (shipped in v0.9.20): copilot_messages.tokens_out is declared by no released schema and was never read or written.
ALTER TABLE "copilot_messages" DROP COLUMN IF EXISTS "tokens_out";--> statement-breakpoint
-- migration-safe: no released app code reads or writes the waitlist table.
DROP TABLE IF EXISTS "waitlist";--> statement-breakpoint
-- migration-safe: contract of 0426 (shipped in v0.9.22): released dispatchers read only file_search_dispatch_queue, and the trigger redefined above no longer enqueues here.
DROP TABLE IF EXISTS "workspace_file_search_dispatch_queue";--> statement-breakpoint
-- migration-safe: contract of 0359 (shipped in v0.8.43): chunk search (workspace_file_search_revision/chunk) replaced the legacy index; no released app code or trigger reads or writes it.
DROP TABLE IF EXISTS "workspace_file_search_index";--> statement-breakpoint
-- migration-safe: contract of 0359 (shipped in v0.8.43): chunk search replaced the legacy segments; no released app code or trigger reads or writes them.
DROP TABLE IF EXISTS "workspace_file_search_segment";--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
ALTER TABLE "workspace_file_search_build" VALIDATE CONSTRAINT "file_search_build_owner_check";--> statement-breakpoint
ALTER TABLE "workspace_file_search_revision" VALIDATE CONSTRAINT "file_search_revision_owner_check";--> statement-breakpoint
ALTER TABLE "workspace_file_search_chunk" VALIDATE CONSTRAINT "file_search_chunk_owner_check";--> statement-breakpoint
ALTER TABLE "public_share" VALIDATE CONSTRAINT "public_share_entity_binding_check";--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" VALIDATE CONSTRAINT "oauth_refresh_token_search_resource_check";--> statement-breakpoint
ALTER TABLE "oauth_access_token" VALIDATE CONSTRAINT "oauth_access_token_search_resource_check";--> statement-breakpoint
-- migration-safe: personal-token inserts conflict on the organization-scoped identity index; no released query relies on the workspace-scoped one.
DROP INDEX CONCURRENTLY IF EXISTS "credential_personal_token_identity_unique";--> statement-breakpoint
SET lock_timeout = '5s';
