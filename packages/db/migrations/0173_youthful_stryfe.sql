CREATE TABLE "mothership_inbox_allowed_sender" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"label" text,
	"added_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mothership_inbox_task" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text,
	"subject" text NOT NULL,
	"body_preview" text,
	"body_text" text,
	"body_html" text,
	"email_message_id" text,
	"in_reply_to" text,
	"response_message_id" text,
	"agentmail_message_id" text,
	"status" text DEFAULT 'received' NOT NULL,
	"chat_id" uuid,
	"trigger_job_id" text,
	"result_summary" text,
	"error_message" text,
	"rejection_reason" text,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"cc_recipients" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processing_started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mothership_inbox_webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"webhook_id" text NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mothership_inbox_webhook_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "inbox_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "inbox_address" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "inbox_provider_id" text;--> statement-breakpoint
ALTER TABLE "mothership_inbox_allowed_sender" ADD CONSTRAINT "mothership_inbox_allowed_sender_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mothership_inbox_allowed_sender" ADD CONSTRAINT "mothership_inbox_allowed_sender_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mothership_inbox_task" ADD CONSTRAINT "mothership_inbox_task_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mothership_inbox_task" ADD CONSTRAINT "mothership_inbox_task_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mothership_inbox_webhook" ADD CONSTRAINT "mothership_inbox_webhook_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_sender_ws_email_idx" ON "mothership_inbox_allowed_sender" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX "inbox_task_ws_created_at_idx" ON "mothership_inbox_task" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "inbox_task_ws_status_idx" ON "mothership_inbox_task" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "inbox_task_response_msg_id_idx" ON "mothership_inbox_task" USING btree ("response_message_id");--> statement-breakpoint
CREATE INDEX "inbox_task_email_msg_id_idx" ON "mothership_inbox_task" USING btree ("email_message_id");