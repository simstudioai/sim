-- Older deployments already journaled 0326 before it included the partial status.
-- Widen the existing check atomically; every previously valid status remains valid.
-- migration-safe: Atomic widening of the 0319 status check to match the already-deployed partial writer from 0326; all old statuses remain accepted and no rows or columns are removed.
ALTER TABLE "knowledge_connector_member_sync_log"
  DROP CONSTRAINT IF EXISTS "kcmsl_status_check",
  ADD CONSTRAINT "kcmsl_status_check"
    CHECK ("status" IN ('started', 'partial', 'completed', 'failed')) NOT VALID;
