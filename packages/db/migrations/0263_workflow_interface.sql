CREATE TABLE "workflow_interface" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"user_id" text NOT NULL,
	"identifier" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"customizations" json DEFAULT '{}',
	"auth_type" text DEFAULT 'public' NOT NULL,
	"output_configs" json DEFAULT '[]',
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_interface" ADD CONSTRAINT "workflow_interface_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_interface" ADD CONSTRAINT "workflow_interface_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_interface_identifier_idx" ON "workflow_interface" USING btree ("identifier") WHERE "workflow_interface"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_interface_workflow_active_idx" ON "workflow_interface" USING btree ("workflow_id") WHERE "workflow_interface"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workflow_interface_archived_at_partial_idx" ON "workflow_interface" USING btree ("archived_at") WHERE "workflow_interface"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workflow_interface_workflow_archived_at_idx" ON "workflow_interface" USING btree ("workflow_id","archived_at");