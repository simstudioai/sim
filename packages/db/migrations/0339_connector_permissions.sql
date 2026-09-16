-- migration-safe: Additive private connector permission tables only; existing connector and worker schemas remain unchanged. Deploy before compatible workers and application UI.
CREATE TABLE "knowledge_connector_permission_grant" (
	"connector_id" text NOT NULL,
	"group_key" text NOT NULL,
	"subject_token" text NOT NULL,
	CONSTRAINT "kcpg_pk" PRIMARY KEY("connector_id","group_key","subject_token"),
	CONSTRAINT "kcpg_group_check" CHECK (length("knowledge_connector_permission_grant"."group_key") BETWEEN 1 AND 255),
	CONSTRAINT "kcpg_subject_check" CHECK ("knowledge_connector_permission_grant"."subject_token" ~ '^u:[^[:space:]A-Z]+@[^[:space:]A-Z]+$')
);
--> statement-breakpoint
CREATE TABLE "knowledge_connector_permission_snapshot" (
	"connector_id" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"metadata" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "kcps_revision_check" CHECK ("knowledge_connector_permission_snapshot"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "knowledge_connector_permission_grant" ADD CONSTRAINT "kcpg_snapshot_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."knowledge_connector_permission_snapshot"("connector_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_connector_permission_snapshot" ADD CONSTRAINT "kcps_connector_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."knowledge_connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kcpg_subject_idx" ON "knowledge_connector_permission_grant" USING btree ("subject_token","connector_id","group_key");