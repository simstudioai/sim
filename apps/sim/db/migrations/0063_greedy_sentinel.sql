CREATE TABLE "document_tag_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"tag_slot" text NOT NULL,
	"display_name" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_tag_definitions" ADD CONSTRAINT "document_tag_definitions_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_tag_definitions_doc_slot_idx" ON "document_tag_definitions" USING btree ("document_id","tag_slot");--> statement-breakpoint
CREATE INDEX "doc_tag_definitions_doc_id_idx" ON "document_tag_definitions" USING btree ("document_id");