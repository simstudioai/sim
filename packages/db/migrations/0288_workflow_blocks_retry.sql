-- migration-safe: a nullable additive column. NULL means "never retries", which is exactly how every released version already behaves, so old and new app versions read and write these rows interchangeably throughout the deploy.
ALTER TABLE "workflow_blocks" ADD COLUMN "retry" jsonb;
