CREATE TYPE "public"."a2a_task_status" AS ENUM('submitted', 'working', 'input-required', 'completed', 'failed', 'canceled', 'rejected', 'auth-required', 'unknown');--> statement-breakpoint
CREATE TABLE "a2a_agent" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"capabilities" jsonb DEFAULT '{}' NOT NULL,
	"skills" jsonb DEFAULT '[]' NOT NULL,
	"authentication" jsonb DEFAULT '{}' NOT NULL,
	"signatures" jsonb DEFAULT '[]',
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "a2a_push_notification_config" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"url" text NOT NULL,
	"token" text,
	"auth_schemes" jsonb DEFAULT '[]',
	"auth_credentials" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "a2a_task" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"session_id" text,
	"status" "a2a_task_status" DEFAULT 'submitted' NOT NULL,
	"messages" jsonb DEFAULT '[]' NOT NULL,
	"artifacts" jsonb DEFAULT '[]',
	"execution_id" text,
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD CONSTRAINT "a2a_agent_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD CONSTRAINT "a2a_agent_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD CONSTRAINT "a2a_agent_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "a2a_push_notification_config" ADD CONSTRAINT "a2a_push_notification_config_task_id_a2a_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."a2a_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "a2a_task" ADD CONSTRAINT "a2a_task_agent_id_a2a_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."a2a_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "a2a_agent_workspace_id_idx" ON "a2a_agent" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "a2a_agent_workflow_id_idx" ON "a2a_agent" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "a2a_agent_created_by_idx" ON "a2a_agent" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "a2a_agent_workspace_workflow_unique" ON "a2a_agent" USING btree ("workspace_id","workflow_id");--> statement-breakpoint
CREATE INDEX "a2a_push_notification_config_task_id_idx" ON "a2a_push_notification_config" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "a2a_push_notification_config_task_unique" ON "a2a_push_notification_config" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "a2a_task_agent_id_idx" ON "a2a_task" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "a2a_task_session_id_idx" ON "a2a_task" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "a2a_task_status_idx" ON "a2a_task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "a2a_task_execution_id_idx" ON "a2a_task" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "a2a_task_created_at_idx" ON "a2a_task" USING btree ("created_at");