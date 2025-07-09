DROP INDEX "emb_metadata_gin_idx";--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "tag1" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "tag2" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "tag3" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "tag4" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "tag5" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "tag6" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "tag7" text;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "tag1" text;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "tag2" text;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "tag3" text;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "tag4" text;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "tag5" text;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "tag6" text;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "tag7" text;--> statement-breakpoint
CREATE INDEX "doc_tag1_idx" ON "document" USING btree ("tag1");--> statement-breakpoint
CREATE INDEX "doc_tag2_idx" ON "document" USING btree ("tag2");--> statement-breakpoint
CREATE INDEX "doc_tag3_idx" ON "document" USING btree ("tag3");--> statement-breakpoint
CREATE INDEX "doc_tag4_idx" ON "document" USING btree ("tag4");--> statement-breakpoint
CREATE INDEX "doc_tag5_idx" ON "document" USING btree ("tag5");--> statement-breakpoint
CREATE INDEX "doc_tag6_idx" ON "document" USING btree ("tag6");--> statement-breakpoint
CREATE INDEX "doc_tag7_idx" ON "document" USING btree ("tag7");--> statement-breakpoint
CREATE INDEX "emb_tag1_idx" ON "embedding" USING btree ("tag1");--> statement-breakpoint
CREATE INDEX "emb_tag2_idx" ON "embedding" USING btree ("tag2");--> statement-breakpoint
CREATE INDEX "emb_tag3_idx" ON "embedding" USING btree ("tag3");--> statement-breakpoint
CREATE INDEX "emb_tag4_idx" ON "embedding" USING btree ("tag4");--> statement-breakpoint
CREATE INDEX "emb_tag5_idx" ON "embedding" USING btree ("tag5");--> statement-breakpoint
CREATE INDEX "emb_tag6_idx" ON "embedding" USING btree ("tag6");--> statement-breakpoint
CREATE INDEX "emb_tag7_idx" ON "embedding" USING btree ("tag7");--> statement-breakpoint
ALTER TABLE "embedding" DROP COLUMN "metadata";