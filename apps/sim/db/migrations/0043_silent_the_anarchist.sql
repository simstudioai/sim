CREATE TABLE "workflow_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"position_x" integer NOT NULL,
	"position_y" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"horizontal_handles" boolean DEFAULT true NOT NULL,
	"is_wide" boolean DEFAULT false NOT NULL,
	"height" integer DEFAULT 0 NOT NULL,
	"sub_blocks" jsonb DEFAULT '{}' NOT NULL,
	"outputs" jsonb DEFAULT '{}' NOT NULL,
	"data" jsonb DEFAULT '{}',
	"parent_id" text,
	"extent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"source_block_id" text NOT NULL,
	"target_block_id" text NOT NULL,
	"source_handle" text,
	"target_handle" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_subflows" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD CONSTRAINT "workflow_blocks_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD CONSTRAINT "workflow_blocks_parent_id_workflow_blocks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."workflow_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_source_block_id_workflow_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."workflow_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_target_block_id_workflow_blocks_id_fk" FOREIGN KEY ("target_block_id") REFERENCES "public"."workflow_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_subflows" ADD CONSTRAINT "workflow_subflows_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_blocks_workflow_id_idx" ON "workflow_blocks" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_blocks_parent_id_idx" ON "workflow_blocks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "workflow_blocks_workflow_parent_idx" ON "workflow_blocks" USING btree ("workflow_id","parent_id");--> statement-breakpoint
CREATE INDEX "workflow_blocks_workflow_type_idx" ON "workflow_blocks" USING btree ("workflow_id","type");--> statement-breakpoint
CREATE INDEX "workflow_edges_workflow_id_idx" ON "workflow_edges" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_source_block_idx" ON "workflow_edges" USING btree ("source_block_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_target_block_idx" ON "workflow_edges" USING btree ("target_block_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_workflow_source_idx" ON "workflow_edges" USING btree ("workflow_id","source_block_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_workflow_target_idx" ON "workflow_edges" USING btree ("workflow_id","target_block_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_source_block_fk_idx" ON "workflow_edges" USING btree ("source_block_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_target_block_fk_idx" ON "workflow_edges" USING btree ("target_block_id");--> statement-breakpoint
CREATE INDEX "workflow_subflows_workflow_id_idx" ON "workflow_subflows" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_subflows_workflow_type_idx" ON "workflow_subflows" USING btree ("workflow_id","type");