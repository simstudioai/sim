DROP INDEX "member_user_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "member_user_id_unique" ON "member" USING btree ("user_id");