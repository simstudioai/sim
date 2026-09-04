-- External directory groups for admin-mode knowledge connectors: who belongs to the groups an
-- admin-mode crawl mirrors onto document ACLs.
--
-- Groups are scoped by workspace, provider and tenant rather than by connector, so two connectors
-- over the same directory resolve it once. Membership is stored by case-folded email rather than
-- by Sim user id: a directory reports addresses, and most members of a granted group have no Sim
-- account, so an address means a person who signs up later inherits their grants with no backfill.
--
-- Both tables are new and empty, so this runs entirely inside the migration runner's batch
-- transaction and rolls back cleanly on failure; no concurrent index build is needed.
CREATE TABLE "knowledge_external_group" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"external_group_id" text NOT NULL,
	"display_name" text,
	"last_synced_at" timestamp,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_external_group_member" (
	"group_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_external_group_member_group_id_email_pk" PRIMARY KEY("group_id","email")
);
--> statement-breakpoint
ALTER TABLE "knowledge_external_group" ADD CONSTRAINT "knowledge_external_group_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_external_group_member" ADD CONSTRAINT "knowledge_external_group_member_group_id_knowledge_external_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_external_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "keg_identity_unique" ON "knowledge_external_group" USING btree ("workspace_id","provider_id","tenant_id","external_group_id");--> statement-breakpoint
CREATE INDEX "keg_workspace_synced_idx" ON "knowledge_external_group" USING btree ("workspace_id","last_synced_at" NULLS FIRST);--> statement-breakpoint
CREATE INDEX "kegm_email_idx" ON "knowledge_external_group_member" USING btree ("email");