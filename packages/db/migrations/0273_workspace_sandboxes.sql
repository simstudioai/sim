CREATE TYPE "public"."sandbox_image_status" AS ENUM('pending', 'building', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sandbox_language" AS ENUM('javascript', 'python');--> statement-breakpoint
CREATE TABLE "sandbox_image" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"spec_hash" text NOT NULL,
	"spec" jsonb NOT NULL,
	"status" "sandbox_image_status" DEFAULT 'pending' NOT NULL,
	"image_ref" text,
	"provider_image_id" text,
	"build_id" text,
	"error_code" text,
	"error_message" text,
	"error_detail" text,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_sandbox" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"language" "sandbox_language" NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spec_hash" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_sandbox" ADD CONSTRAINT "workspace_sandbox_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_sandbox" ADD CONSTRAINT "workspace_sandbox_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_image_provider_spec_unique" ON "sandbox_image" USING btree ("provider","spec_hash");--> statement-breakpoint
CREATE INDEX "sandbox_image_status_idx" ON "sandbox_image" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sandbox_image_last_used_idx" ON "sandbox_image" USING btree ("last_used_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_sandbox_workspace_name_unique" ON "workspace_sandbox" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "workspace_sandbox_workspace_idx" ON "workspace_sandbox" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_sandbox_spec_hash_idx" ON "workspace_sandbox" USING btree ("spec_hash");