CREATE TABLE "knowledge_base_tag_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"tag_slot" text NOT NULL,
	"display_name" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_base_tag_definitions" ADD CONSTRAINT "knowledge_base_tag_definitions_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_tag_definitions_kb_slot_idx" ON "knowledge_base_tag_definitions" USING btree ("knowledge_base_id","tag_slot");--> statement-breakpoint
CREATE INDEX "kb_tag_definitions_kb_id_idx" ON "knowledge_base_tag_definitions" USING btree ("knowledge_base_id");