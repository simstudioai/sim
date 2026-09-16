CREATE TABLE "slack_app" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"kind" text NOT NULL,
	"client_id" text NOT NULL,
	"encrypted_client_secret" text NOT NULL,
	"encrypted_signing_secret" text NOT NULL,
	"revision" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_app_owner_check" CHECK (("slack_app"."kind" = 'custom' AND "slack_app"."organization_id" IS NOT NULL) OR ("slack_app"."kind" = 'shared' AND "slack_app"."organization_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "slack_search_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"app_id" text NOT NULL,
	"slack_app_id" text,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"enterprise_id" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"credential_version" text NOT NULL,
	"revision" text NOT NULL,
	"last_outcome" text,
	"last_event_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_search_turn" (
	"id" text PRIMARY KEY NOT NULL,
	"ordinal" integer GENERATED ALWAYS AS IDENTITY (sequence name "slack_search_turn_ordinal_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"installation_id" text NOT NULL,
	"conversation_key" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"lease_id" text,
	"lease_expires_at" timestamp,
	"outcome" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD COLUMN "external_conversation_key" text;--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD COLUMN "external_conversation_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "slack_app_id" text;--> statement-breakpoint
ALTER TABLE "slack_app" ADD CONSTRAINT "slack_app_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_search_installation" ADD CONSTRAINT "slack_search_installation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_search_installation" ADD CONSTRAINT "slack_search_installation_credential_id_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_search_installation" ADD CONSTRAINT "slack_search_installation_slack_app_id_slack_app_id_fk" FOREIGN KEY ("slack_app_id") REFERENCES "public"."slack_app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_search_turn" ADD CONSTRAINT "slack_search_turn_installation_id_slack_search_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."slack_search_installation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_search_installation_organization_idx" ON "slack_search_installation" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_search_installation_credential_unique" ON "slack_search_installation" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_search_installation_app_team_unique" ON "slack_search_installation" USING btree ("app_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_search_installation_active_team_unique" ON "slack_search_installation" USING btree ("team_id") WHERE "slack_search_installation"."enabled" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_search_turn_event_unique" ON "slack_search_turn" USING btree ("installation_id","event_id");--> statement-breakpoint
CREATE INDEX "slack_search_turn_pending_idx" ON "slack_search_turn" USING btree ("installation_id","status","created_at");--> statement-breakpoint
CREATE INDEX "slack_search_turn_thread_idx" ON "slack_search_turn" USING btree ("conversation_key","status");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_search_turn_active_thread_unique" ON "slack_search_turn" USING btree ("conversation_key") WHERE "slack_search_turn"."status" = 'running';--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_slack_app_id_slack_app_id_fk" FOREIGN KEY ("slack_app_id") REFERENCES "public"."slack_app"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
COMMIT;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "copilot_chats_external_conversation_unique" ON "copilot_chats" USING btree ("external_conversation_key") WHERE "copilot_chats"."external_conversation_key" IS NOT NULL;
--> statement-breakpoint
SET lock_timeout = '5s';
