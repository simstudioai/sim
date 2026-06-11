CREATE TABLE "sim_trigger_state" (
	"workflow_id" text NOT NULL,
	"block_id" text NOT NULL,
	"scope_key" text DEFAULT '' NOT NULL,
	"last_fired_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_trigger_state_workflow_id_block_id_scope_key_pk" PRIMARY KEY("workflow_id","block_id","scope_key")
);
--> statement-breakpoint
DROP TABLE "workspace_notification_delivery" CASCADE;--> statement-breakpoint
DROP TABLE "workspace_notification_subscription" CASCADE;--> statement-breakpoint
ALTER TABLE "sim_trigger_state" ADD CONSTRAINT "sim_trigger_state_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."notification_delivery_status";--> statement-breakpoint
DROP TYPE "public"."notification_type";