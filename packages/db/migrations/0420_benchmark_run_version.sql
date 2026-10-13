SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "mothership_benchmark_runs" ADD CONSTRAINT "mothership_benchmark_runs_version_check" CHECK ("mothership_benchmark_runs"."version" > 0) NOT VALID;
