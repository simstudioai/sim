CREATE TABLE "mothership_benchmark_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"benchmark_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"evaluation_key" text NOT NULL,
	"reviews" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reviewed_at" timestamp,
	"correct" integer NOT NULL,
	"automatic_correct" integer NOT NULL,
	"total" integer NOT NULL,
	"artifacts" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mothership_benchmark_runs_score_check" CHECK ("mothership_benchmark_runs"."total" > 0 AND "mothership_benchmark_runs"."correct" >= 0 AND "mothership_benchmark_runs"."correct" <= "mothership_benchmark_runs"."total")
);
--> statement-breakpoint
ALTER TABLE "mothership_benchmark_runs" ADD CONSTRAINT "mothership_benchmark_runs_benchmark_id_mothership_benchmarks_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."mothership_benchmarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mothership_benchmark_runs_benchmark_created_idx" ON "mothership_benchmark_runs" USING btree ("benchmark_id","created_at","id");