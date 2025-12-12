CREATE TABLE "memory" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"data" json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_key_idx" ON "memory" USING btree ("key");--> statement-breakpoint
CREATE INDEX "memory_workflow_idx" ON "memory" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_workflow_key_idx" ON "memory" USING btree ("workflow_id","key");