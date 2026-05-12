ALTER TYPE "public"."data_drain_destination" ADD VALUE 'gcs' BEFORE 'webhook';--> statement-breakpoint
ALTER TYPE "public"."data_drain_destination" ADD VALUE 'azure_blob' BEFORE 'webhook';--> statement-breakpoint
ALTER TYPE "public"."data_drain_destination" ADD VALUE 'datadog' BEFORE 'webhook';--> statement-breakpoint
ALTER TYPE "public"."data_drain_destination" ADD VALUE 'bigquery' BEFORE 'webhook';--> statement-breakpoint
ALTER TYPE "public"."data_drain_destination" ADD VALUE 'snowflake' BEFORE 'webhook';