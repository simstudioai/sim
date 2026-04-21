CREATE TYPE "public"."invitation_kind" AS ENUM('organization', 'workspace');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."workspace_mode" AS ENUM('personal', 'organization', 'grandfathered_shared');--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "workspace_mode" "workspace_mode" DEFAULT 'grandfathered_shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_owner_id_idx" ON "workspace" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "workspace_organization_id_idx" ON "workspace" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workspace_mode_idx" ON "workspace" USING btree ("workspace_mode");--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "kind" "invitation_kind" DEFAULT 'organization' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
UPDATE "invitation" SET "token" = gen_random_uuid()::text WHERE "token" IS NULL;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "token" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_token_unique" UNIQUE("token");--> statement-breakpoint
UPDATE "invitation" SET "status" = 'pending' WHERE "status" NOT IN ('pending', 'accepted', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "status" SET DATA TYPE "public"."invitation_status" USING "status"::"public"."invitation_status";--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_kind_requires_org_id" CHECK ("kind" = 'workspace' OR "organization_id" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "invitation_status_idx" ON "invitation" USING btree ("status");--> statement-breakpoint
CREATE TABLE "invitation_workspace_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"invitation_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"permission" "permission_type" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation_workspace_grant" ADD CONSTRAINT "invitation_workspace_grant_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_workspace_grant" ADD CONSTRAINT "invitation_workspace_grant_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_workspace_grant_unique" ON "invitation_workspace_grant" USING btree ("invitation_id","workspace_id");--> statement-breakpoint
CREATE INDEX "invitation_workspace_grant_workspace_id_idx" ON "invitation_workspace_grant" USING btree ("workspace_id");--> statement-breakpoint
INSERT INTO "invitation_workspace_grant" ("id", "invitation_id", "workspace_id", "permission", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  wi."org_invitation_id",
  wi."workspace_id",
  wi."permissions",
  wi."created_at",
  wi."updated_at"
FROM "workspace_invitation" wi
JOIN "invitation" i ON i."id" = wi."org_invitation_id"
WHERE wi."org_invitation_id" IS NOT NULL
ON CONFLICT ("invitation_id", "workspace_id") DO NOTHING;--> statement-breakpoint
CREATE TEMP TABLE "_ws_invitation_id_map" (
  old_id text PRIMARY KEY,
  new_id text NOT NULL UNIQUE
);--> statement-breakpoint
INSERT INTO "_ws_invitation_id_map" (old_id, new_id)
SELECT wi."id", gen_random_uuid()::text
FROM "workspace_invitation" wi
WHERE wi."org_invitation_id" IS NULL;--> statement-breakpoint
INSERT INTO "invitation" ("id", "kind", "email", "inviter_id", "organization_id", "role", "status", "token", "expires_at", "created_at", "updated_at")
SELECT
  m.new_id,
  'workspace'::"invitation_kind",
  wi."email",
  wi."inviter_id",
  w."organization_id",
  wi."role",
  (CASE
    WHEN wi."status"::text IN ('pending', 'accepted', 'rejected', 'cancelled') THEN wi."status"::text
    ELSE 'pending'
  END)::"invitation_status",
  wi."token",
  wi."expires_at",
  wi."created_at",
  wi."updated_at"
FROM "workspace_invitation" wi
JOIN "_ws_invitation_id_map" m ON m.old_id = wi."id"
JOIN "workspace" w ON w."id" = wi."workspace_id"
WHERE wi."org_invitation_id" IS NULL;--> statement-breakpoint
INSERT INTO "invitation_workspace_grant" ("id", "invitation_id", "workspace_id", "permission", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  m.new_id,
  wi."workspace_id",
  wi."permissions",
  wi."created_at",
  wi."updated_at"
FROM "workspace_invitation" wi
JOIN "_ws_invitation_id_map" m ON m.old_id = wi."id"
WHERE wi."org_invitation_id" IS NULL;--> statement-breakpoint
DROP TABLE "_ws_invitation_id_map";--> statement-breakpoint
DROP TABLE "workspace_invitation" CASCADE;--> statement-breakpoint
DROP TYPE "public"."workspace_invitation_status";--> statement-breakpoint
WITH ranked AS (
  SELECT "id",
    ROW_NUMBER() OVER (
      PARTITION BY "email", "organization_id"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS rn
  FROM "invitation"
  WHERE "status" = 'pending' AND "organization_id" IS NOT NULL
)
UPDATE "invitation"
SET "status" = 'cancelled', "updated_at" = now()
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_email_org_unique" ON "invitation" USING btree ("email","organization_id") WHERE "invitation"."status" = 'pending' AND "invitation"."organization_id" IS NOT NULL;
