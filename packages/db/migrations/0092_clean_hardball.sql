CREATE TABLE "workflow_form" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"block_id" text,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"form_config" json NOT NULL,
	"styling" json DEFAULT '{}',
	"settings" json DEFAULT '{}',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_log_webhook" ALTER COLUMN "trigger_filter" SET DEFAULT ARRAY['api', 'webhook', 'schedule', 'manual', 'chat', 'form']::text[];--> statement-breakpoint
ALTER TABLE "workflow_form" ADD CONSTRAINT "workflow_form_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_form" ADD CONSTRAINT "workflow_form_block_id_workflow_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."workflow_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_form_path_idx" ON "workflow_form" USING btree ("path");--> statement-breakpoint
CREATE INDEX "workflow_form_workflow_id_idx" ON "workflow_form" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_form_workflow_block_unique" ON "workflow_form" USING btree ("workflow_id","block_id");