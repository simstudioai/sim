CREATE TABLE IF NOT EXISTS "issue" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"number_scope_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body_file_id" text NOT NULL,
	"status" text DEFAULT 'inbox' NOT NULL,
	"close_reason" text,
	"duplicate_of_id" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"owner_id" text,
	"working_chat_id" uuid,
	"review_summary" text,
	"created_by_actor" jsonb NOT NULL,
	"created_by_user_id" text,
	"fingerprint" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_status_check" CHECK ("issue"."status" IN ('inbox', 'in_progress', 'done')),
	CONSTRAINT "issue_close_reason_check" CHECK (("issue"."status" = 'done') = ("issue"."close_reason" IS NOT NULL) AND ("issue"."close_reason" IS NULL OR "issue"."close_reason" IN ('completed', 'dismissed', 'duplicate'))),
	CONSTRAINT "issue_working_chat_check" CHECK ("issue"."status" <> 'in_progress' OR "issue"."working_chat_id" IS NOT NULL),
	CONSTRAINT "issue_priority_check" CHECK ("issue"."priority" BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_counter" (
	"scope_id" text PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_event" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"actor" jsonb,
	"actor_user_id" text,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_external_link" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_key" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"status" text,
	"credential_id" text,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_external_link_provider_check" CHECK ("issue_external_link"."provider" IN ('linear', 'jira'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_resource" (
	"issue_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_resource_issue_id_resource_type_resource_id_pk" PRIMARY KEY("issue_id","resource_type","resource_id")
);
--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD COLUMN IF NOT EXISTS "issue_id" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."issue"'::regclass AND conname = 'issue_workspace_id_workspace_id_fk'
  ) THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."issue"'::regclass AND conname = 'issue_body_file_id_workspace_files_id_fk'
  ) THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_body_file_id_workspace_files_id_fk" FOREIGN KEY ("body_file_id") REFERENCES "public"."workspace_files"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."issue"'::regclass AND conname = 'issue_duplicate_of_id_issue_id_fk'
  ) THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_duplicate_of_id_issue_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."issue"'::regclass AND conname = 'issue_owner_id_user_id_fk'
  ) THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."issue"'::regclass AND conname = 'issue_working_chat_id_copilot_chats_id_fk'
  ) THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_working_chat_id_copilot_chats_id_fk" FOREIGN KEY ("working_chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."issue"'::regclass AND conname = 'issue_created_by_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."issue_event"'::regclass AND conname = 'issue_event_issue_id_issue_id_fk'
  ) THEN
    ALTER TABLE "issue_event" ADD CONSTRAINT "issue_event_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."issue_event"'::regclass AND conname = 'issue_event_actor_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "issue_event" ADD CONSTRAINT "issue_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."issue_external_link"'::regclass AND conname = 'issue_external_link_issue_id_issue_id_fk'
  ) THEN
    ALTER TABLE "issue_external_link" ADD CONSTRAINT "issue_external_link_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."issue_resource"'::regclass AND conname = 'issue_resource_issue_id_issue_id_fk'
  ) THEN
    ALTER TABLE "issue_resource" ADD CONSTRAINT "issue_resource_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_number_scope_unique" ON "issue" USING btree ("number_scope_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_body_file_unique" ON "issue" USING btree ("body_file_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_workspace_status_idx" ON "issue" USING btree ("workspace_id","status","updated_at") WHERE "issue"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_working_chat_idx" ON "issue" USING btree ("working_chat_id") WHERE "issue"."working_chat_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_open_fingerprint_unique" ON "issue" USING btree ("workspace_id","fingerprint") WHERE "issue"."fingerprint" IS NOT NULL AND "issue"."status" <> 'done' AND "issue"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_event_issue_created_idx" ON "issue_event" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_external_link_issue_ticket_unique" ON "issue_external_link" USING btree ("issue_id","provider","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_external_link_ticket_idx" ON "issue_external_link" USING btree ("provider","external_id");--> statement-breakpoint
-- The column is new and empty, so NOT VALID skips a scan of the chat table and leaves nothing unchecked.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."copilot_chats"'::regclass AND conname = 'copilot_chats_issue_id_issue_id_fk'
  ) THEN
    ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint

-- Losing the working chat of an open issue (it was detached, or deleted and the foreign key cleared
-- it) sends a working issue back to the inbox and records it, so in_progress always has a chat.
CREATE OR REPLACE FUNCTION issue_working_chat_detached() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.working_chat_id IS NULL AND OLD.working_chat_id IS NOT NULL AND OLD.status <> 'done' THEN
    IF NEW.status = 'in_progress' THEN
      NEW.status := 'inbox';
    END IF;
    INSERT INTO issue_event (id, issue_id, kind, payload)
    VALUES (gen_random_uuid()::text, NEW.id, 'chat_detached', jsonb_build_object('chatId', OLD.working_chat_id));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS issue_working_chat_detached_trigger ON issue;--> statement-breakpoint
CREATE TRIGGER issue_working_chat_detached_trigger
BEFORE UPDATE OF working_chat_id ON issue
FOR EACH ROW EXECUTE FUNCTION issue_working_chat_detached();--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: everything above is replay-safe, and replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "copilot_chats_issue_id_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "copilot_chats_issue_id_idx" ON "copilot_chats" USING btree ("issue_id") WHERE "copilot_chats"."issue_id" IS NOT NULL;
--> statement-breakpoint
SET lock_timeout = '5s';
