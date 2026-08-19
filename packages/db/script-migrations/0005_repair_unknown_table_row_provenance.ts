import type { Sql } from 'postgres'
import type { ScriptMigration } from './types'

export const UNKNOWN_PROVENANCE_REPAIR_BATCH_SIZE = 1000

/**
 * Returns one page of `unknown` rows to the untracked state, and reports how many it cleared.
 *
 * Both halves are required and belong in one statement. Clearing the marker while a sidecar row
 * survives beside it is the state a derived table transformation reads as unknown, so a split
 * repair would be undone by the next column operation.
 *
 * `secret_provenance_version` is not a column the demote trigger watches, so this leaves
 * `updated_at` alone and cannot disturb a concurrent write's sidecar binding.
 */
async function repairUnknownProvenancePage(sql: Sql, batchSize: number): Promise<number> {
  const repaired = await sql<{ id: string }[]>`
    WITH page AS (
      SELECT row_id
      FROM user_table_row_secret_provenance
      WHERE status = 'unknown'
      LIMIT ${batchSize}
    ), cleared AS (
      DELETE FROM user_table_row_secret_provenance
      WHERE row_id IN (SELECT row_id FROM page)
      RETURNING row_id
    )
    UPDATE user_table_rows
    SET secret_provenance_version = NULL
    WHERE id IN (SELECT row_id FROM cleared)
    RETURNING id
  `
  return repaired.length
}

/**
 * Clears the backlog of table rows whose secret provenance nobody recorded.
 *
 * A sidecar reading `unknown` asserts that nobody recorded which secrets the row's cells carry. An
 * untracked row asserts exactly the same thing, and the read path already lets it through:
 * `loadTableRowSecretProvenance` skips a row whose `secret_provenance_version` is NULL *before* it
 * reaches the enforcement branch, so an untracked row stays readable even once the table-row
 * surface is closed. The two states differ only in that one is durable.
 *
 * That difference is what makes the surface un-closable. Nothing heals an `unknown` row in place —
 * a partial cell update keeps it unknown and only a full replace carrying complete provenance
 * clears it — so every such row would fail every run that later read it, forever. This restores
 * them to the state the system already tolerates, so the surface can eventually be closed against
 * newly written provenance rather than against a backlog.
 *
 * Deliberately a relabel rather than a reconstruction. Rescanning each cell against the
 * workspace's current secret catalog would recover real provenance where secrets have not rotated,
 * but it is a much larger job that reports its own false negatives. The relabel claims strictly
 * less than the rows did: "unrecorded", which is true of every one of them.
 *
 * Idempotent and resumable: a repaired row no longer has a sidecar, so it leaves the candidate set
 * and a re-run after a crash resumes on what remains. Rows that become unknown after this runs are
 * simply left for the writers now instrumented to report them.
 */
export const repairUnknownTableRowProvenance: ScriptMigration = {
  name: '0005_repair_unknown_table_row_provenance',
  async up(sql: Sql): Promise<void> {
    let repaired = 0
    for (;;) {
      const page = await repairUnknownProvenancePage(sql, UNKNOWN_PROVENANCE_REPAIR_BATCH_SIZE)
      if (page === 0) break
      repaired += page
      console.log(`  repaired ${repaired} unknown table row(s)`)
    }
    console.log(`Unknown table row provenance repair complete: ${repaired} row(s).`)
  },
}
