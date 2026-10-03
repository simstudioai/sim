-- Whether an organization's members must sign in through its identity provider. Off for every
-- existing row, so the previous release and this one behave identically until an admin turns it on.
ALTER TABLE "organization" ADD COLUMN "require_sso" boolean DEFAULT false NOT NULL;