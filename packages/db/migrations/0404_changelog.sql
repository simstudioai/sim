CREATE TABLE "changelog_change" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"workflow_id" text,
	"deployment_version_id" text,
	"chat_id" uuid
);
--> statement-breakpoint
CREATE TABLE "changelog_release" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"version_major" integer NOT NULL,
	"version_minor" integer NOT NULL,
	"version_patch" integer NOT NULL,
	"bump_reason" text NOT NULL,
	"body_file_id" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "changelog_release_version_check" CHECK ("changelog_release"."version_major" >= 0 AND "changelog_release"."version_minor" >= 0 AND "changelog_release"."version_patch" >= 0)
);
--> statement-breakpoint
ALTER TABLE "changelog_change" ADD CONSTRAINT "changelog_change_release_id_changelog_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."changelog_release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_change" ADD CONSTRAINT "changelog_change_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_change" ADD CONSTRAINT "changelog_change_deployment_version_id_workflow_deployment_version_id_fk" FOREIGN KEY ("deployment_version_id") REFERENCES "public"."workflow_deployment_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_change" ADD CONSTRAINT "changelog_change_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_release" ADD CONSTRAINT "changelog_release_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_release" ADD CONSTRAINT "changelog_release_body_file_id_workspace_files_id_fk" FOREIGN KEY ("body_file_id") REFERENCES "public"."workspace_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_release" ADD CONSTRAINT "changelog_release_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changelog_release" ADD CONSTRAINT "changelog_release_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_change_release_position_unique" ON "changelog_change" USING btree ("release_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_release_workspace_version_unique" ON "changelog_release" USING btree ("workspace_id","version_major","version_minor","version_patch");--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_release_body_file_unique" ON "changelog_release" USING btree ("body_file_id");--> statement-breakpoint
CREATE INDEX "changelog_release_workspace_published_idx" ON "changelog_release" USING btree ("workspace_id","published_at","id");