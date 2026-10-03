-- migration-safe: additive column with a non-null constant default; true preserves the released automatic-provisioning behavior for old and new app versions during rollout.
ALTER TABLE "sso_provider" ADD COLUMN "jit_provisioning_enabled" boolean DEFAULT true NOT NULL;
