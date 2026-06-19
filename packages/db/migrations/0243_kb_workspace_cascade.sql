-- migration-safe: re-creates the existing knowledge_base→workspace FK only to change its ON DELETE action to cascade. The column and FK are otherwise unchanged and the FK is re-added immediately below (atomic within the migration transaction); no app code depends on the FK's delete action.
ALTER TABLE "knowledge_base" DROP CONSTRAINT "knowledge_base_workspace_id_workspace_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "knowledge_base" VALIDATE CONSTRAINT "knowledge_base_workspace_id_workspace_id_fk";
