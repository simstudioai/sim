DROP INDEX "account_user_provider_account_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "account_user_provider_unique" ON "account" USING btree ("user_id","provider_id");