CREATE INDEX "api_key_workspace_type_idx" ON "api_key" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE INDEX "api_key_user_type_idx" ON "api_key" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "verification" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "workflow_blocks_type_idx" ON "workflow_blocks" USING btree ("type");