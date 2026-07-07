import type { Sql } from 'postgres'

/**
 * A run-once TypeScript data migration, applied by the migration runner
 * (`scripts/migrate.ts`) after all pending SQL migrations succeed and recorded
 * by name in the `script_migrations` table — the code-migration analogue of
 * drizzle's `__drizzle_migrations` journal.
 *
 * Authoring rules:
 * - **Idempotent and resumable.** The name is recorded only after `up`
 *   resolves; a crash mid-run means the whole migration re-runs from the top
 *   on the next upgrade. Guard with cheap preconditions (`WHERE x IS NULL`,
 *   `ON CONFLICT DO NOTHING`) so re-runs are near-free.
 * - **db-level imports only** (`postgres`, `drizzle-orm`, `@sim/utils`). The
 *   migrations docker image ships `packages/db` + `utils` + `logger` and
 *   nothing from `apps/*`.
 * - **Runs at whatever schema HEAD the release ships** — scripts are not
 *   interleaved with SQL migrations. A SQL migration must never drop or
 *   repurpose a column that a registered script still reads; delete the
 *   script from the registry in the same PR instead.
 * - **Owns its transactions.** The runner deliberately does not wrap `up` in
 *   one: backfills commit per batch and cannot be rolled back wholesale.
 */
export interface ScriptMigration {
  /** Unique stable identifier recorded in `script_migrations`; never rename after release. */
  name: string
  /** Env vars the migration needs; the runner throws before `up` if any is unset. */
  requiredEnv?: readonly string[]
  /** Applies the migration using the runner's session (statement_timeout is already 0). */
  up(sql: Sql): Promise<void>
}
