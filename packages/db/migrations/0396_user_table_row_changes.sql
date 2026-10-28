CREATE TABLE "user_table_row_changes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_table_row_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"table_id" text NOT NULL,
	"row_delta" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_table_row_changes" ADD CONSTRAINT "user_table_row_changes_table_id_user_table_definitions_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."user_table_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_table_row_changes_table_id_idx" ON "user_table_row_changes" USING btree ("table_id");