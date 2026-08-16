-- migration-safe: additive enums, nullable columns, and new empty tables are backward-compatible; constraints on the existing credential table are NOT VALID and its indexes are created concurrently.
CREATE TYPE "public"."credential_group_enrollment_status" AS ENUM('invited', 'delivery_failed', 'in_progress', 'completed', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."credential_group_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."managed_oauth_credential_status" AS ENUM('active', 'needs_reauth', 'revoked');--> statement-breakpoint
ALTER TYPE "public"."credential_type" ADD VALUE 'managed_oauth' BEFORE 'env_workspace';--> statement-breakpoint
CREATE TABLE "credential_group" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"options" jsonb NOT NULL,
	"encrypted_provider_configuration" text,
	"status" "credential_group_status" DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_group_enrollment" (
	"id" text PRIMARY KEY NOT NULL,
	"credential_group_id" text NOT NULL,
	"email" text NOT NULL,
	"status" "credential_group_enrollment_status" DEFAULT 'invited' NOT NULL,
	"invitation_token_hash" text NOT NULL,
	"invitation_expires_at" timestamp NOT NULL,
	"invited_at" timestamp NOT NULL,
	"sent_at" timestamp,
	"completed_at" timestamp,
	"revoked_at" timestamp,
	"last_delivery_error" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credential_group_enrollment_normalized_email_check" CHECK ("credential_group_enrollment"."email" = lower(btrim("credential_group_enrollment"."email")) AND length("credential_group_enrollment"."email") BETWEEN 3 AND 320),
	CONSTRAINT "credential_group_enrollment_invitation_token_hash_length_check" CHECK (length("credential_group_enrollment"."invitation_token_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "authorization_app_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "credential_group_enrollment_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "credential_group_option_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "managed_oauth_scope_version" integer;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "provider_subject_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "provider_tenant_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "managed_oauth_status" "managed_oauth_credential_status";--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "granted_scopes" text[];--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "provider_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "encrypted_oauth_token_set" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "granted_at" timestamp;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "access_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "refresh_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "last_refreshed_at" timestamp;--> statement-breakpoint
ALTER TABLE "credential_group" ADD CONSTRAINT "credential_group_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_group" ADD CONSTRAINT "credential_group_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_group_enrollment" ADD CONSTRAINT "credential_group_enrollment_credential_group_id_credential_group_id_fk" FOREIGN KEY ("credential_group_id") REFERENCES "public"."credential_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_group_enrollment" ADD CONSTRAINT "credential_group_enrollment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_group_public_id_unique" ON "credential_group" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "credential_group_workspace_status_idx" ON "credential_group" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_group_workspace_name_unique" ON "credential_group" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "credential_group_enrollment_group_email_unique" ON "credential_group_enrollment" USING btree ("credential_group_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_group_enrollment_invitation_token_hash_unique" ON "credential_group_enrollment" USING btree ("invitation_token_hash");--> statement-breakpoint
CREATE INDEX "credential_group_enrollment_group_status_idx" ON "credential_group_enrollment" USING btree ("credential_group_id","status");--> statement-breakpoint
CREATE INDEX "credential_group_enrollment_group_invited_at_id_idx" ON "credential_group_enrollment" USING btree ("credential_group_id","invited_at","id");--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_credential_group_enrollment_id_credential_group_enrollment_id_fk" FOREIGN KEY ("credential_group_enrollment_id") REFERENCES "public"."credential_group_enrollment"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_enrollment_idx" ON "credential" USING btree ("credential_group_enrollment_id");--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_option_unique" ON "credential" USING btree ("credential_group_enrollment_id","credential_group_option_id") WHERE "credential"."type" = 'managed_oauth';--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_managed_oauth_source_check" CHECK ((type::text <> 'managed_oauth') OR (
        account_id IS NULL
        AND provider_id IS NOT NULL
        AND authorization_app_id IS NOT NULL
        AND provider_subject_id IS NOT NULL
        AND managed_oauth_status IS NOT NULL
        AND granted_scopes IS NOT NULL
        AND cardinality(granted_scopes) > 0
        AND encrypted_oauth_token_set IS NOT NULL
        AND granted_at IS NOT NULL
      )) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_managed_oauth_group_binding_check" CHECK ((type::text <> 'managed_oauth') OR (
        credential_group_enrollment_id IS NOT NULL
        AND credential_group_option_id IS NOT NULL
        AND managed_oauth_scope_version IS NOT NULL
        AND managed_oauth_scope_version > 0
      )) NOT VALID;
