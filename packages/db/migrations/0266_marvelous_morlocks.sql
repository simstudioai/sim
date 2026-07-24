CREATE TABLE "workflow_block_annotation" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"block_id" text NOT NULL,
	"content" text NOT NULL,
	"created_by" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_block_annotation" ADD CONSTRAINT "workflow_block_annotation_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_block_annotation" ADD CONSTRAINT "workflow_block_annotation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_block_annotation" ADD CONSTRAINT "workflow_block_annotation_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_block_annotation_workflow_id_idx" ON "workflow_block_annotation" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_block_annotation_workflow_block_idx" ON "workflow_block_annotation" USING btree ("workflow_id","block_id");