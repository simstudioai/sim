CREATE TYPE "public"."skill_member_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."skill_member_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "skill_member" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "skill_member_role" DEFAULT 'member' NOT NULL,
	"status" "skill_member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp,
	"invited_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "workspace_shared" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_member" ADD CONSTRAINT "skill_member_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_member" ADD CONSTRAINT "skill_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_member" ADD CONSTRAINT "skill_member_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_member_user_id_idx" ON "skill_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skill_member_role_idx" ON "skill_member" USING btree ("role");--> statement-breakpoint
CREATE INDEX "skill_member_status_idx" ON "skill_member" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_member_unique" ON "skill_member" USING btree ("skill_id","user_id");--> statement-breakpoint
-- Backfill: existing skills predate per-skill ACLs, where any workspace `write` user
-- could edit any skill. Grant those users an explicit skill admin row so their edit
-- rights survive the cutover. Workspace admins get no rows (derived skill admins at
-- runtime), and `read` users get no rows (covered by the implicit member grant from
-- skill.workspace_shared, which the column default just turned on for every existing
-- skill). The permissions table is unique on (user_id, entity_type, entity_id), so the
-- write-row join alone excludes admins. Idempotent: deterministic ids + ON CONFLICT.
-- Deploy window: a skill created by a still-running OLD pod after this runs gets no
-- creator admin row (old code doesn't write skill_member), leaving its creator an
-- implicit member until promoted. Re-running this INSERT once after full cutover
-- heals those skills — it is deterministic and conflict-safe by design.
INSERT INTO "skill_member" ("id", "skill_id", "user_id", "role", "status", "joined_at", "invited_by", "created_at", "updated_at")
SELECT
    'skillm_' || md5(s."id" || ':' || p."user_id"),
    s."id",
    p."user_id",
    'admin'::"skill_member_role",
    'active'::"skill_member_status",
    now(),
    s."user_id",
    now(),
    now()
FROM "skill" s
INNER JOIN "permissions" p
    ON p."entity_type" = 'workspace'
    AND p."entity_id" = s."workspace_id"
    AND p."permission_type" = 'write'
WHERE s."workspace_id" IS NOT NULL
ON CONFLICT DO NOTHING;