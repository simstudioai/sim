-- migration-safe: table-local maintenance settings only; a catalog update under SHARE UPDATE EXCLUSIVE, which reads and writes do not wait on, with no row rewrite.
-- Vacuuming these tables writes WAL, mostly full-page images, faster than the synchronous standbys
-- flush it, so every write commit on the primary waits on a standby for as long as the vacuum runs.
-- A per-table cost delay and limit cap that rate. This reverses 0362's choice for these tables
-- only: they leave cross-worker I/O balancing and vacuum more slowly, the lesser cost here. The
-- TOAST values would be inherited, but are set explicitly because the TOAST vacuums are the largest.
ALTER TABLE "embedding" SET (autovacuum_vacuum_cost_delay = 10, autovacuum_vacuum_cost_limit = 200, toast.autovacuum_vacuum_cost_delay = 10, toast.autovacuum_vacuum_cost_limit = 200);--> statement-breakpoint
ALTER TABLE "embedding_search" SET (autovacuum_vacuum_cost_delay = 10, autovacuum_vacuum_cost_limit = 200, toast.autovacuum_vacuum_cost_delay = 10, toast.autovacuum_vacuum_cost_limit = 200);--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" SET (autovacuum_vacuum_cost_delay = 10, autovacuum_vacuum_cost_limit = 200, toast.autovacuum_vacuum_cost_delay = 10, toast.autovacuum_vacuum_cost_limit = 200);
