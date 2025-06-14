CREATE TABLE "workflow_edge" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"source" text NOT NULL,
	"target" text NOT NULL,
	"source_handle" text,
	"target_handle" text,
	"type" text DEFAULT 'default',
	"animated" boolean DEFAULT false,
	"style" json DEFAULT '{}',
	"data" json DEFAULT '{}',
	"version" integer DEFAULT 1 NOT NULL,
	"last_modified" timestamp DEFAULT now() NOT NULL,
	"modified_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_loop" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"nodes" json DEFAULT '[]' NOT NULL,
	"iterations" integer DEFAULT 1 NOT NULL,
	"loop_type" text NOT NULL,
	"for_each_items" json,
	"execution_state" json DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_modified" timestamp DEFAULT now() NOT NULL,
	"modified_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_node" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"position_x" integer NOT NULL,
	"position_y" integer NOT NULL,
	"sub_blocks" json DEFAULT '{}' NOT NULL,
	"outputs" json DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"horizontal_handles" boolean DEFAULT false,
	"is_wide" boolean DEFAULT false,
	"height" integer,
	"advanced_mode" boolean DEFAULT false,
	"data" json DEFAULT '{}',
	"parent_id" text,
	"extent" text,
	"version" integer DEFAULT 1 NOT NULL,
	"last_modified" timestamp DEFAULT now() NOT NULL,
	"modified_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_parallel" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"nodes" json DEFAULT '[]' NOT NULL,
	"distribution" json,
	"execution_state" json DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_modified" timestamp DEFAULT now() NOT NULL,
	"modified_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow" ALTER COLUMN "collaborators" SET DEFAULT '[]'::json;--> statement-breakpoint
ALTER TABLE "workflow" ALTER COLUMN "variables" SET DEFAULT '{}'::json;--> statement-breakpoint
ALTER TABLE "workflow_edge" ADD CONSTRAINT "workflow_edge_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edge" ADD CONSTRAINT "workflow_edge_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_loop" ADD CONSTRAINT "workflow_loop_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_loop" ADD CONSTRAINT "workflow_loop_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node" ADD CONSTRAINT "workflow_node_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node" ADD CONSTRAINT "workflow_node_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_parallel" ADD CONSTRAINT "workflow_parallel_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_parallel" ADD CONSTRAINT "workflow_parallel_modified_by_user_id_fk" FOREIGN KEY ("modified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_edge_workflow_id_idx" ON "workflow_edge" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_edge_source_idx" ON "workflow_edge" USING btree ("source");--> statement-breakpoint
CREATE INDEX "workflow_edge_target_idx" ON "workflow_edge" USING btree ("target");--> statement-breakpoint
CREATE INDEX "workflow_edge_workflow_version_idx" ON "workflow_edge" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflow_edge_sync_idx" ON "workflow_edge" USING btree ("workflow_id","last_modified","version");--> statement-breakpoint
CREATE INDEX "workflow_edge_connection_idx" ON "workflow_edge" USING btree ("source","target");--> statement-breakpoint
CREATE INDEX "workflow_loop_workflow_id_idx" ON "workflow_loop" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_loop_workflow_version_idx" ON "workflow_loop" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflow_loop_sync_idx" ON "workflow_loop" USING btree ("workflow_id","last_modified","version");--> statement-breakpoint
CREATE INDEX "workflow_node_workflow_id_idx" ON "workflow_node" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_node_workflow_version_idx" ON "workflow_node" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflow_node_parent_id_idx" ON "workflow_node" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "workflow_node_last_modified_idx" ON "workflow_node" USING btree ("last_modified");--> statement-breakpoint
CREATE INDEX "workflow_node_sync_idx" ON "workflow_node" USING btree ("workflow_id","last_modified","version");--> statement-breakpoint
CREATE INDEX "workflow_parallel_workflow_id_idx" ON "workflow_parallel" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_parallel_workflow_version_idx" ON "workflow_parallel" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflow_parallel_sync_idx" ON "workflow_parallel" USING btree ("workflow_id","last_modified","version");