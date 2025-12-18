ALTER TABLE "document" ADD COLUMN "number1" double precision;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "number2" double precision;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "number3" double precision;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "number4" double precision;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "number5" double precision;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "date1" timestamp;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "date2" timestamp;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "boolean1" boolean;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "boolean2" boolean;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "boolean3" boolean;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "number1" double precision;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "number2" double precision;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "number3" double precision;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "number4" double precision;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "number5" double precision;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "date1" timestamp;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "date2" timestamp;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "boolean1" boolean;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "boolean2" boolean;--> statement-breakpoint
ALTER TABLE "embedding" ADD COLUMN "boolean3" boolean;--> statement-breakpoint
CREATE INDEX "doc_number1_idx" ON "document" USING btree ("number1");--> statement-breakpoint
CREATE INDEX "doc_number2_idx" ON "document" USING btree ("number2");--> statement-breakpoint
CREATE INDEX "doc_number3_idx" ON "document" USING btree ("number3");--> statement-breakpoint
CREATE INDEX "doc_number4_idx" ON "document" USING btree ("number4");--> statement-breakpoint
CREATE INDEX "doc_number5_idx" ON "document" USING btree ("number5");--> statement-breakpoint
CREATE INDEX "doc_date1_idx" ON "document" USING btree ("date1");--> statement-breakpoint
CREATE INDEX "doc_date2_idx" ON "document" USING btree ("date2");--> statement-breakpoint
CREATE INDEX "doc_boolean1_idx" ON "document" USING btree ("boolean1");--> statement-breakpoint
CREATE INDEX "doc_boolean2_idx" ON "document" USING btree ("boolean2");--> statement-breakpoint
CREATE INDEX "doc_boolean3_idx" ON "document" USING btree ("boolean3");--> statement-breakpoint
CREATE INDEX "emb_number1_idx" ON "embedding" USING btree ("number1");--> statement-breakpoint
CREATE INDEX "emb_number2_idx" ON "embedding" USING btree ("number2");--> statement-breakpoint
CREATE INDEX "emb_number3_idx" ON "embedding" USING btree ("number3");--> statement-breakpoint
CREATE INDEX "emb_number4_idx" ON "embedding" USING btree ("number4");--> statement-breakpoint
CREATE INDEX "emb_number5_idx" ON "embedding" USING btree ("number5");--> statement-breakpoint
CREATE INDEX "emb_date1_idx" ON "embedding" USING btree ("date1");--> statement-breakpoint
CREATE INDEX "emb_date2_idx" ON "embedding" USING btree ("date2");--> statement-breakpoint
CREATE INDEX "emb_boolean1_idx" ON "embedding" USING btree ("boolean1");--> statement-breakpoint
CREATE INDEX "emb_boolean2_idx" ON "embedding" USING btree ("boolean2");--> statement-breakpoint
CREATE INDEX "emb_boolean3_idx" ON "embedding" USING btree ("boolean3");