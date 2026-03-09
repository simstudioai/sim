ALTER TABLE "knowledge_base" DROP CONSTRAINT "knowledge_base_workspace_id_workspace_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;