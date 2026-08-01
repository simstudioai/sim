CREATE TABLE "workspace_interface" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"layout" jsonb DEFAULT '{"version":1,"grid":{"rows":2,"cols":2},"modules":[]}'::jsonb NOT NULL,
	"archived_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_interface" ADD CONSTRAINT "workspace_interface_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_interface" ADD CONSTRAINT "workspace_interface_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_interface_workspace_id_idx" ON "workspace_interface" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_interface_workspace_name_unique" ON "workspace_interface" USING btree ("workspace_id","name") WHERE "workspace_interface"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_interface_archived_at_idx" ON "workspace_interface" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "workspace_interface_workspace_archived_partial_idx" ON "workspace_interface" USING btree ("workspace_id","archived_at") WHERE "workspace_interface"."archived_at" IS NOT NULL;