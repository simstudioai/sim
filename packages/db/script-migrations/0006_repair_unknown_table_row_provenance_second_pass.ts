import type { Sql } from 'postgres'
import { runUnknownTableRowProvenanceRepair } from './0005_repair_unknown_table_row_provenance'
import type { ScriptMigration } from './types'

/**
 * Clears the rows that went `unknown` after 0005 had already run.
 *
 * 0005 was correct and is finished: the runner records a name in `script_migrations` and never
 * offers it again, which is exactly the contract a run-once repair wants. But it cleared the
 * backlog that existed at the instant it ran, and the writers that produced that backlog kept
 * running afterwards — a table write whose block could not project one input latched the run's
 * registry, so its rows were stored unrecorded, for as long as that bug was live.
 *
 * Nothing heals such a row in place; a partial cell update keeps it unknown and only a full replace
 * carrying complete provenance clears it. So each one goes on reporting on every later read, which
 * is why a few dozen rows account for thousands of log lines a week. A second pass is the whole
 * remedy.
 *
 * A new entry rather than deleting 0005's tracking row: the registry is append-only, and a repair
 * that ran twice should say so twice.
 *
 * It assumes the writer that produced these is already live-fixed, and that is a deploy-ordering
 * requirement rather than something this file can enforce. `promote-images` needs `migrate`, so a
 * script migration runs while the previous image is still serving: any row an old instance creates
 * between this walk and the end of the rollout is behind the cursor, and the name is recorded on
 * success, so it is never offered again. Widening the walk would not help — it is the minutes after
 * it returns that are exposed, not the milliseconds during. Ship this in a release *after* the
 * writer fix is already promoted, and the window closes because nothing is producing rows to miss.
 *
 * Shares 0005's implementation rather than restating it. The walk locks the parent row before the
 * sidecar to match the application writer's order, and re-checks `status` under that lock so a
 * concurrently committed exact sidecar is never deleted — subtleties worth having once, not twice.
 * Idempotent, so it costs one empty query when there is nothing left to repair.
 */
export const repairUnknownTableRowProvenanceSecondPass: ScriptMigration = {
  name: '0006_repair_unknown_table_row_provenance_second_pass',
  up: (sql: Sql) => runUnknownTableRowProvenanceRepair(sql),
}
