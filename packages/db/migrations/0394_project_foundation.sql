CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organization_id" text,
	"owner_id" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_name_length" CHECK (char_length(btrim("project"."name")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "project_workspace" (
	"project_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_workspace_project_id_workspace_id_pk" PRIMARY KEY("project_id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workspace" ADD CONSTRAINT "project_workspace_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workspace" ADD CONSTRAINT "project_workspace_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_organization_archive_id_idx" ON "project" USING btree ("organization_id","archived_at","id");--> statement-breakpoint
CREATE INDEX "project_owner_archive_id_idx" ON "project" USING btree ("owner_id","archived_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_workspace_workspace_id_unique" ON "project_workspace" USING btree ("workspace_id");