ALTER TABLE "document" DROP CONSTRAINT "document_connector_id_knowledge_connector_id_fk";
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_connector_id_knowledge_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."knowledge_connector"("id") ON DELETE set null ON UPDATE no action;