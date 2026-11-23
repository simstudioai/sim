CREATE TABLE "knowledge_connector_permission_import" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_id" text NOT NULL,
	"credential_binding" text NOT NULL,
	"expected_revision" integer NOT NULL,
	"metadata" jsonb NOT NULL,
	"manifest" jsonb NOT NULL,
	"part_digests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_rows" integer DEFAULT 0 NOT NULL,
	"project_rows" integer DEFAULT 0 NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"completed_revision" integer,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "kcpi_revision_check" CHECK ("knowledge_connector_permission_import"."expected_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_connector_permission_import_grant" (
	"import_id" text NOT NULL,
	"project_path" text NOT NULL,
	"user_id" text NOT NULL,
	"group_key" text,
	CONSTRAINT "kcpig_pk" PRIMARY KEY("import_id","project_path","user_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_connector_permission_import_identity" (
	"import_id" text NOT NULL,
	"user_id" text NOT NULL,
	"subject_token" text NOT NULL,
	CONSTRAINT "kcpii_pk" PRIMARY KEY("import_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "knowledge_connector_permission_import" ADD CONSTRAINT "knowledge_connector_permission_import_connector_id_knowledge_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."knowledge_connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_connector_permission_import_grant" ADD CONSTRAINT "knowledge_connector_permission_import_grant_import_id_knowledge_connector_permission_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."knowledge_connector_permission_import"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_connector_permission_import_identity" ADD CONSTRAINT "knowledge_connector_permission_import_identity_import_id_knowledge_connector_permission_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."knowledge_connector_permission_import"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kcpi_connector_idx" ON "knowledge_connector_permission_import" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "kcpi_expires_idx" ON "knowledge_connector_permission_import" USING btree ("expires_at","id");--> statement-breakpoint
CREATE INDEX "kcpig_subject_idx" ON "knowledge_connector_permission_import_grant" USING btree ("import_id","user_id","group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "kcpii_subject_idx" ON "knowledge_connector_permission_import_identity" USING btree ("import_id","subject_token");