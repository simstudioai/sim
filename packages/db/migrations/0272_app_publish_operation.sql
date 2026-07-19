CREATE TABLE "app_publish_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"requested_by" text,
	"source_revision_id" text NOT NULL,
	"expected_version" integer,
	"stage" text DEFAULT 'deploying' NOT NULL,
	"deployments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rebound_revision_id" text NOT NULL,
	"build_id" text,
	"release_id" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"lease_token" text,
	"lease_expires_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_publish_operation_stage_check" CHECK ("app_publish_operation"."stage" IN ('deploying', 'rebinding', 'building', 'preparing', 'publishing', 'published'))
);
--> statement-breakpoint
ALTER TABLE "app_publish_operation" ADD CONSTRAINT "app_publish_operation_project_id_app_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."app_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_publish_operation" ADD CONSTRAINT "app_publish_operation_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_publish_operation" ADD CONSTRAINT "app_publish_operation_source_revision_id_app_source_revision_id_fk" FOREIGN KEY ("source_revision_id") REFERENCES "public"."app_source_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_publish_operation" ADD CONSTRAINT "app_publish_operation_build_id_app_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."app_build"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_publish_operation_project_created_idx" ON "app_publish_operation" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "app_publish_operation_stage_updated_idx" ON "app_publish_operation" USING btree ("stage","updated_at");