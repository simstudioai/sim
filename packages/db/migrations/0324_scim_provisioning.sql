CREATE TABLE "scim_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_request_at" timestamp,
	"reconcile_lock_token" text,
	"reconcile_lease_at" timestamp,
	"reconciled_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"revoked_by" text,
	"last_used_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_group" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"external_id" text,
	"display_name" text NOT NULL,
	"display_name_key" text NOT NULL,
	"order_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_group_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"permission_group_id" text,
	"workspace_id" text,
	"permission_type" "permission_type",
	"role" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scim_group_mapping_target_shape" CHECK ((
        ("scim_group_mapping"."target_kind" = 'permission_group' AND "scim_group_mapping"."permission_group_id" IS NOT NULL AND "scim_group_mapping"."workspace_id" IS NULL AND "scim_group_mapping"."permission_type" IS NULL AND "scim_group_mapping"."role" IS NULL)
        OR ("scim_group_mapping"."target_kind" = 'workspace' AND "scim_group_mapping"."workspace_id" IS NOT NULL AND "scim_group_mapping"."permission_type" IS NOT NULL AND "scim_group_mapping"."permission_group_id" IS NULL AND "scim_group_mapping"."role" IS NULL)
        OR ("scim_group_mapping"."target_kind" = 'org_role' AND "scim_group_mapping"."role" IS NOT NULL AND "scim_group_mapping"."permission_group_id" IS NULL AND "scim_group_mapping"."workspace_id" IS NULL AND "scim_group_mapping"."permission_type" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "scim_group_member" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"scim_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_projection_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"scim_user_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"permission_type" "permission_type",
	"origin" text DEFAULT 'directory' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_request_log" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"credential_id" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer NOT NULL,
	"scim_type" text,
	"detail" text,
	"user_agent" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_user" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"user_id" text NOT NULL,
	"external_id" text,
	"user_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"attributes" jsonb NOT NULL,
	"order_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_user_tombstone" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"external_id" text NOT NULL,
	"user_id" text NOT NULL,
	"deleted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "permission_group" ADD COLUMN "membership_mode" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspension_source" text;--> statement-breakpoint
ALTER TABLE "scim_connection" ADD CONSTRAINT "scim_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_connection" ADD CONSTRAINT "scim_connection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_credential" ADD CONSTRAINT "scim_credential_connection_id_scim_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."scim_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_credential" ADD CONSTRAINT "scim_credential_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_credential" ADD CONSTRAINT "scim_credential_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_group" ADD CONSTRAINT "scim_group_connection_id_scim_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."scim_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_group_mapping" ADD CONSTRAINT "scim_group_mapping_group_id_scim_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."scim_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_group_mapping" ADD CONSTRAINT "scim_group_mapping_permission_group_id_permission_group_id_fk" FOREIGN KEY ("permission_group_id") REFERENCES "public"."permission_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_group_mapping" ADD CONSTRAINT "scim_group_mapping_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_group_mapping" ADD CONSTRAINT "scim_group_mapping_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_group_id_scim_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."scim_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_scim_user_id_scim_user_id_fk" FOREIGN KEY ("scim_user_id") REFERENCES "public"."scim_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_projection_grant" ADD CONSTRAINT "scim_projection_grant_connection_id_scim_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."scim_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_projection_grant" ADD CONSTRAINT "scim_projection_grant_scim_user_id_scim_user_id_fk" FOREIGN KEY ("scim_user_id") REFERENCES "public"."scim_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_request_log" ADD CONSTRAINT "scim_request_log_connection_id_scim_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."scim_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_user" ADD CONSTRAINT "scim_user_connection_id_scim_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."scim_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_user" ADD CONSTRAINT "scim_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_user_tombstone" ADD CONSTRAINT "scim_user_tombstone_connection_id_scim_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."scim_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_user_tombstone" ADD CONSTRAINT "scim_user_tombstone_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scim_connection_organization_unique" ON "scim_connection" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scim_connection_reconcile_due_idx" ON "scim_connection" USING btree ("reconciled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_credential_token_hash_unique" ON "scim_credential" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "scim_credential_connection_idx" ON "scim_credential" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_group_connection_display_name_unique" ON "scim_group" USING btree ("connection_id","display_name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_group_connection_external_id_unique" ON "scim_group" USING btree ("connection_id","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE INDEX "scim_group_connection_order_idx" ON "scim_group" USING btree ("connection_id","order_key");--> statement-breakpoint
CREATE INDEX "scim_group_mapping_group_idx" ON "scim_group_mapping" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "scim_group_mapping_permission_group_idx" ON "scim_group_mapping" USING btree ("permission_group_id");--> statement-breakpoint
CREATE INDEX "scim_group_mapping_workspace_idx" ON "scim_group_mapping" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_group_mapping_group_target_unique" ON "scim_group_mapping" USING btree ("group_id","target_kind",coalesce("permission_group_id", "workspace_id", "role"));--> statement-breakpoint
CREATE UNIQUE INDEX "scim_group_member_group_user_unique" ON "scim_group_member" USING btree ("group_id","scim_user_id");--> statement-breakpoint
CREATE INDEX "scim_group_member_scim_user_idx" ON "scim_group_member" USING btree ("scim_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_projection_grant_user_target_unique" ON "scim_projection_grant" USING btree ("scim_user_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "scim_projection_grant_connection_idx" ON "scim_projection_grant" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "scim_request_log_connection_created_idx" ON "scim_request_log" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_user_connection_user_unique" ON "scim_user" USING btree ("connection_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_user_connection_user_name_unique" ON "scim_user" USING btree ("connection_id","user_name");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_user_connection_external_id_unique" ON "scim_user" USING btree ("connection_id","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE INDEX "scim_user_connection_order_idx" ON "scim_user" USING btree ("connection_id","order_key");--> statement-breakpoint
CREATE INDEX "scim_user_user_idx" ON "scim_user" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_user_tombstone_connection_external_id_unique" ON "scim_user_tombstone" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "scim_user_tombstone_user_idx" ON "scim_user_tombstone" USING btree ("user_id");