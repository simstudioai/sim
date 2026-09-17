-- migration-safe: table-local maintenance settings only; no row rewrite or change to old readers and writers.
-- Status transitions leave obsolete entries in the pending index. Lower vacuum and
-- analyze thresholds keep index visibility and planner estimates aligned with queue churn.
ALTER TABLE "outbox_event" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
