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
 * - **db-level imports only** (`postgres`, `drizzle-orm`, `@sim/utils`,
 *   `@sim/security`). The migrations docker image ships `packages/db` + `utils`
 *   + `logger` + `security` and nothing from `apps/*`.
 * - **Runs at whatever schema HEAD the release ships** — scripts are not
 *   interleaved with SQL migrations. A SQL migration must never drop or
 *   repurpose a column that a registered script still reads; delete the
 *   script from the registry in the same PR instead.
 * - **Owns its transactions.** The runner deliberately does not wrap `up` in
 *   one: backfills commit per batch and cannot be rolled back wholesale.
 * - **May defer.** A migration that needs a configuration the deployment may
 *   not have yet throws {@link ScriptMigrationDeferred}: nothing is recorded,
 *   later migrations still run, and the runner tries it again on every run
 *   until it applies. No later migration may depend on the work of one that
 *   can defer.
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

/** Thrown by `up` to leave a migration unrecorded, without failing the run, until a later run. */
export class ScriptMigrationDeferred extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ScriptMigrationDeferred'
  }
}
