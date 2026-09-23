-- Documents whose search projection rows may lag their source rows. The table is new, so the
-- foreign key validates no rows and only briefly locks `document` under the runner's lock timeout.
-- Script migration `0024_knowledge_projection_async` installs the triggers that mark it.
CREATE TABLE "knowledge_projection_dirty" (
	"document_id" text PRIMARY KEY NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"content" boolean DEFAULT false NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_projection_dirty" ADD CONSTRAINT "knowledge_projection_dirty_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_projection_dirty_marked_at_idx" ON "knowledge_projection_dirty" USING btree ("marked_at");--> statement-breakpoint
-- Search reads the whole table per statement while every mark is inserted and deleted within
-- seconds, so it is vacuumed after a fixed number of dead rows rather than a share of a tiny table.
ALTER TABLE "knowledge_projection_dirty" SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 1000, autovacuum_analyze_scale_factor = 0, autovacuum_analyze_threshold = 1000);