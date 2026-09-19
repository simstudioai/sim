CREATE TABLE IF NOT EXISTS "copilot_organization_request_stops" (
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"stream_id" text NOT NULL,
	"stopped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copilot_organization_request_stops_user_id_organization_id_stream_id_pk" PRIMARY KEY("user_id","organization_id","stream_id"),
	CONSTRAINT "copilot_organization_request_stops_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "copilot_organization_request_stops_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "copilot_request_stops" (
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"stream_id" text NOT NULL,
	"stopped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copilot_request_stops_user_id_workspace_id_stream_id_pk" PRIMARY KEY("user_id","workspace_id","stream_id"),
	CONSTRAINT "copilot_request_stops_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "copilot_request_stops_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "copilot_task_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"execution_id" text NOT NULL,
	"chat_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "copilot_task_subscriptions_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "copilot_task_subscriptions_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "copilot_task_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mothership_resource_effects" (
	"chat_id" uuid NOT NULL,
	"effect_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mothership_resource_effects_chat_id_effect_id_pk" PRIMARY KEY("chat_id","effect_id"),
	CONSTRAINT "mothership_resource_effects_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN IF NOT EXISTS "execution_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN IF NOT EXISTS "execution_settled_at" timestamp;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN IF NOT EXISTS "execution_owner_token" text;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN IF NOT EXISTS "execution_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN IF NOT EXISTS "execution_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN IF NOT EXISTS "client_workflow_execution_id" text;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN IF NOT EXISTS "sandbox_processes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_runs" ADD COLUMN IF NOT EXISTS "tool_execution_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_runs" ADD COLUMN IF NOT EXISTS "tool_admission_closed_at" timestamp;--> statement-breakpoint
ALTER TABLE "copilot_runs" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
-- Organization ownership is optional for existing workspace runs. NOT VALID avoids
-- scanning the populated run table while still checking every new or changed owner.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."copilot_runs"'::regclass
      AND conname = 'copilot_runs_organization_id_organization_id_fk'
  ) THEN
    ALTER TABLE "copilot_runs" ADD CONSTRAINT "copilot_runs_organization_id_organization_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
      ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- The deployed revamp already has populated subscription tables. Rebuild only
-- failed concurrent indexes, preserving every valid index and existing unique key.
COMMIT;
--> statement-breakpoint
SET lock_timeout = '5s';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('"public"."copilot_task_subscriptions_execution_idx_failed_0345"')
      AND (indisvalid OR indrelid <> '"public"."copilot_task_subscriptions"'::regclass)
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected index copilot_task_subscriptions_execution_idx_failed_0345';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('"public"."copilot_task_subscriptions_execution_idx"')
      AND indrelid = '"public"."copilot_task_subscriptions"'::regclass
      AND NOT indisvalid
  ) THEN
    ALTER INDEX "public"."copilot_task_subscriptions_execution_idx" RENAME TO "copilot_task_subscriptions_execution_idx_failed_0345";
  END IF;
END $$;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
-- migration-safe: Only the invalid subscription index left by 0345 is renamed above. Valid deployed indexes remain intact; the failed build is replaced concurrently without removing rows.
DROP INDEX CONCURRENTLY IF EXISTS "public"."copilot_task_subscriptions_execution_idx_failed_0345";
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "copilot_task_subscriptions_execution_idx" ON "copilot_task_subscriptions" USING btree ("execution_id");
--> statement-breakpoint
SET lock_timeout = '5s';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('"public"."copilot_task_subscriptions_task_idx_failed_0345"')
      AND (indisvalid OR indrelid <> '"public"."copilot_task_subscriptions"'::regclass)
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected index copilot_task_subscriptions_task_idx_failed_0345';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('"public"."copilot_task_subscriptions_task_idx"')
      AND indrelid = '"public"."copilot_task_subscriptions"'::regclass
      AND NOT indisvalid
  ) THEN
    ALTER INDEX "public"."copilot_task_subscriptions_task_idx" RENAME TO "copilot_task_subscriptions_task_idx_failed_0345";
  END IF;
END $$;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
-- migration-safe: Only the invalid subscription index left by 0345 is renamed above. Valid deployed indexes remain intact; the failed build is replaced concurrently without removing rows.
DROP INDEX CONCURRENTLY IF EXISTS "public"."copilot_task_subscriptions_task_idx_failed_0345";
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "copilot_task_subscriptions_task_idx" ON "copilot_task_subscriptions" USING btree ("task_id");
--> statement-breakpoint
SET lock_timeout = '5s';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('copilot_task_subscriptions_execution_idx', false),
      ('copilot_task_subscriptions_task_idx', true)
    ) AS required(name, is_unique)
    LEFT JOIN pg_index AS actual ON actual.indexrelid = to_regclass('public.' || required.name)
      AND actual.indrelid = '"public"."copilot_task_subscriptions"'::regclass
    WHERE NOT COALESCE(actual.indisvalid AND actual.indisready
      AND actual.indisunique = required.is_unique, false)
  ) THEN
    RAISE EXCEPTION 'Mothership migration requires valid subscription indexes';
  END IF;
END $$;
