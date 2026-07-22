CREATE TABLE "skill_member" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"user_id" text NOT NULL,
	"invited_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_member" ADD CONSTRAINT "skill_member_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_member" ADD CONSTRAINT "skill_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_member" ADD CONSTRAINT "skill_member_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_member_user_id_idx" ON "skill_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_member_unique" ON "skill_member" USING btree ("skill_id","user_id");--> statement-breakpoint
-- Backfill: existing skills predate the editors list, where any workspace `write` user
-- could edit any skill. Grant those users an explicit editor row so their edit rights
-- survive the cutover. Workspace admins get no rows (they are derived editors at
-- runtime), which the write-only permission join guarantees — the permissions table is
-- unique on (user_id, entity_type, entity_id). Everyone with workspace access can see
-- and use every skill regardless of rows, so no other grants are needed.
-- Idempotent and deploy-window re-runnable: deterministic ids + ON CONFLICT DO NOTHING,
-- so re-running this INSERT once after full cutover heals any skill created by a
-- still-running old pod during the deploy window.
INSERT INTO "skill_member" ("id", "skill_id", "user_id", "invited_by", "created_at", "updated_at")
SELECT 'skillm_' || md5(s."id" || ':' || p."user_id"), s."id", p."user_id", s."user_id", now(), now()
FROM "skill" s
INNER JOIN "permissions" p ON p."entity_type" = 'workspace' AND p."entity_id" = s."workspace_id" AND p."permission_type" = 'write'
WHERE s."workspace_id" IS NOT NULL
ON CONFLICT DO NOTHING;
