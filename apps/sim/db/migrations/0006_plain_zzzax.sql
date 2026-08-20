CREATE TABLE "workflow_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"execution_id" text,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"general" json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "environment" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"variables" json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "environment_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "logs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_environment" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "logs" CASCADE;--> statement-breakpoint
DROP TABLE "user_environment" CASCADE;--> statement-breakpoint
DROP TABLE "user_settings" CASCADE;--> statement-breakpoint
ALTER TABLE "workflow" ALTER COLUMN "state" SET DATA TYPE json USING state::json;--> statement-breakpoint
ALTER TABLE "workflow_logs" ADD CONSTRAINT "workflow_logs_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;