CREATE TABLE "agent_memory_turn" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"block_id" text NOT NULL,
	"node_id" text NOT NULL,
	"execution_order" integer NOT NULL,
	"encrypted_state" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_artifact" (
	"memory_id" text NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "memory_artifact_memory_id_key_pk" PRIMARY KEY("memory_id","key")
);
--> statement-breakpoint
CREATE TABLE "memory_item" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "memory_item_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"append_key" text NOT NULL,
	"turn_id" text,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"provenance_status" text NOT NULL,
	"provenance_entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memory_item_kind_check" CHECK ("memory_item"."kind" IN ('message', 'exchange')),
	CONSTRAINT "memory_item_provenance_status_check" CHECK ("memory_item"."provenance_status" IN ('exact', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "storage_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_memory_turn" ADD CONSTRAINT "agent_memory_turn_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_turn" ADD CONSTRAINT "agent_memory_turn_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_artifact" ADD CONSTRAINT "memory_artifact_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_artifact" ADD CONSTRAINT "memory_artifact_key_execution_large_values_key_fk" FOREIGN KEY ("key") REFERENCES "public"."execution_large_values"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_item" ADD CONSTRAINT "memory_item_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memory_turn_invocation_unique" ON "agent_memory_turn" USING btree ("memory_id","workflow_id","execution_id","block_id","node_id","execution_order");--> statement-breakpoint
CREATE INDEX "agent_memory_turn_workflow_idx" ON "agent_memory_turn" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "memory_artifact_key_idx" ON "memory_artifact" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_item_append_unique" ON "memory_item" USING btree ("memory_id","append_key");--> statement-breakpoint
CREATE INDEX "memory_item_sequence_idx" ON "memory_item" USING btree ("memory_id","sequence");