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
  /** Earlier, unregistered migrations whose work this migration fully completes. Recorded only on success. */
  supersedes?: readonly string[]
  /** Env vars the migration needs; the runner throws before `up` if any is unset. */
  requiredEnv?: readonly string[]
  /**
   * Applies the migration using the runner's session. The runner resets
   * `statement_timeout` and `lock_timeout` to 0 first, so long backfills and
   * blocking lock acquisitions wait instead of aborting with `55P03`.
   */
  up(sql: Sql): Promise<void>
}

/**
 * Thrown by `up` to leave the migration unrecorded without failing the upgrade,
 * so the next upgrade runs it again: for work this database refuses today but
 * may accept later, such as an extension the migration role may not yet create.
 */
export class ScriptMigrationDeferred extends Error {
  override name = 'ScriptMigrationDeferred'
}
