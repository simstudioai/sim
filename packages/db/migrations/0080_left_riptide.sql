CREATE TABLE "workspace_environment" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"variables" json DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_environment" ADD CONSTRAINT "workspace_environment_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_environment_workspace_unique" ON "workspace_environment" USING btree ("workspace_id");