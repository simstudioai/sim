ALTER TYPE "public"."workspace_fork_resource_type" ADD VALUE 'sandbox';--> statement-breakpoint
CREATE TABLE "workspace_operation_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"kind" text NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_operation_receipt" ADD CONSTRAINT "workspace_operation_receipt_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_operation_receipt_request_unique" ON "workspace_operation_receipt" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE INDEX "workspace_operation_receipt_workspace_created_idx" ON "workspace_operation_receipt" USING btree ("workspace_id","created_at","id");