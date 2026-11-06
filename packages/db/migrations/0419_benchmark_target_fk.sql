SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "mothership_benchmarks" ADD CONSTRAINT "mothership_benchmarks_run_as_user_id_user_id_fk" FOREIGN KEY ("run_as_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
