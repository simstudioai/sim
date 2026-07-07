-- migration-safe: credential-sets (email polling groups) feature fully removed in this change; prod verified 2026-07-06 at 0 invitations, 0 members, 0 webhooks with credential_set_id, 0 workflow-config references
DROP TABLE "credential_set_invitation" CASCADE;--> statement-breakpoint
-- migration-safe: credential_set_member readers removed with the credential-sets API/fan-out in this change; prod has 0 rows
DROP TABLE "credential_set_member" CASCADE;--> statement-breakpoint
-- migration-safe: credential_set readers removed in this change; CASCADE also drops the webhook.credential_set_id FK constraint; prod has 1 orphaned row with no members, invitations, or webhooks
DROP TABLE "credential_set" CASCADE;--> statement-breakpoint
-- migration-safe: webhook.credential_set_id readers/writers (deploy fan-out, polling plan gate, processor billing gate, webhook routes) all removed in this change; prod verified at 0 non-null values; drops webhook_credential_set_id_idx with it
ALTER TABLE "webhook" DROP COLUMN "credential_set_id";--> statement-breakpoint
-- migration-safe: credential_set_invitation_status enum is only referenced by the credential_set_invitation table dropped above
DROP TYPE "public"."credential_set_invitation_status";--> statement-breakpoint
-- migration-safe: credential_set_member_status enum is only referenced by the credential_set_member table dropped above
DROP TYPE "public"."credential_set_member_status";
