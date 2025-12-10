DELETE FROM account a
USING account b
WHERE a.user_id = b.user_id
  AND a.provider_id = b.provider_id
  AND a.account_id = b.account_id
  AND a.id <> b.id
  AND a.updated_at < b.updated_at;
--> statement-breakpoint
CREATE UNIQUE INDEX "account_user_provider_account_unique" ON "account" USING btree ("user_id","provider_id","account_id");