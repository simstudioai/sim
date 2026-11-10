-- migration-safe: additive nullable column with no default, a catalog-only change. The deployed
-- release neither reads nor writes it; this release stamps it when a retiring personal
-- organization's chats move into a workspace (rehomePersonalOrganizationChatsTx) and keeps a
-- stamped workspace out of every team attach (ownedAttachableWorkspacesWhere). No backfill: no
-- released version retires personal organizations, so no unstamped workspace holds such chats.
ALTER TABLE "workspace" ADD COLUMN "personal_chats_rehomed_at" timestamp;
