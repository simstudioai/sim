-- Step 1: Add new columns to api_key table
ALTER TABLE "api_key" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "type" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint

-- Step 2: Add pinned_api_key_id column to workflow table
ALTER TABLE "workflow" ADD COLUMN "pinned_api_key_id" text;--> statement-breakpoint

-- Step 3: Migrate pinned API key references from text key to foreign key ID
UPDATE "workflow" 
SET "pinned_api_key_id" = ak."id"
FROM "api_key" ak
WHERE "workflow"."pinned_api_key" IS NOT NULL 
  AND ak."key" = "workflow"."pinned_api_key";--> statement-breakpoint

-- Step 4: Add foreign key constraints
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_pinned_api_key_id_api_key_id_fk" FOREIGN KEY ("pinned_api_key_id") REFERENCES "public"."api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Step 5: Add check constraint to ensure data integrity
ALTER TABLE "api_key" ADD CONSTRAINT "workspace_type_check" CHECK ((type = 'workspace' AND workspace_id IS NOT NULL) OR (type = 'personal' AND workspace_id IS NULL));--> statement-breakpoint

-- Step 6: Drop old columns
ALTER TABLE "workflow" DROP COLUMN "pinned_api_key";