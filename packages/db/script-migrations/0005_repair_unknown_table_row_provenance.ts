import type { Sql } from 'postgres'
import type { ScriptMigration } from './types'

export const UNKNOWN_PROVENANCE_REPAIR_BATCH_SIZE = 1000

interface RepairPage {
  /** Rows still reading `unknown` when the page was selected; zero means the walk is done. */
  candidates: number
  /** Rows actually returned to untracked. Lower than `candidates` when a writer got there first. */
  repaired: number
  /** Highest `row_id` in the page, so the next pass resumes past it. */
  lastRowId: string | null
}

/**
 * Returns one page of `unknown` rows to the untracked state.
 *
 * Both halves belong in one statement. Clearing the marker while a sidecar row survives beside it
 * is the state a derived table transformation reads as unknown, so a split repair would be undone
 * by the next column operation.
 *
 * The delete re-checks `status` rather than trusting the id the page captured. A provenance-aware
 * write commits its exact sidecar and its version marker together, and can land between this
 * statement's snapshot and its delete; matching on `row_id` alone would drop that fresh exact
 * sidecar and clear the marker behind it, leaving a genuinely secret-bearing row reading as
 * legacy — provenance destroyed by the repair meant to make provenance safe. Under READ COMMITTED
 * the delete re-evaluates its condition against the updated row, so the writer's row no longer
 * matches and is left alone; whichever of the two commits second sees the other's result.
 *
 * `secret_provenance_version` is not a column the demote trigger watches, so this leaves
 * `updated_at` alone and cannot disturb a concurrent write's sidecar binding.
 */
async function repairUnknownProvenancePage(
  sql: Sql,
  batchSize: number,
  afterRowId: string
): Promise<RepairPage> {
  const [page] = await sql<[RepairPage]>`
    WITH page AS (
      SELECT row_id
      FROM user_table_row_secret_provenance
      WHERE status = 'unknown' AND row_id > ${afterRowId}
      ORDER BY row_id
      LIMIT ${batchSize}
    ), cleared AS (
      DELETE FROM user_table_row_secret_provenance
      WHERE row_id IN (SELECT row_id FROM page)
        AND status = 'unknown'
      RETURNING row_id
    ), marked AS (
      UPDATE user_table_rows
      SET secret_provenance_version = NULL
      WHERE id IN (SELECT row_id FROM cleared)
      RETURNING id
    )
    SELECT
      (SELECT count(*) FROM page)::int AS "candidates",
      (SELECT count(*) FROM marked)::int AS "repaired",
      (SELECT max(row_id) FROM page) AS "lastRowId"
  `
  return page
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
 *
 * Walked by keyset over `row_id` rather than by re-selecting the head of the candidate set. A page
 * whose rows were all repaired by a concurrent writer clears nothing, and terminating on "cleared
 * nothing" would have ended the walk there and left the rest of the backlog untouched. Advancing
 * past the page instead makes each pass finite and the whole walk terminate on the only condition
 * that means finished: a page with no candidates left in it.
 */
export const repairUnknownTableRowProvenance: ScriptMigration = {
  name: '0005_repair_unknown_table_row_provenance',
  async up(sql: Sql): Promise<void> {
    let repaired = 0
    let skipped = 0
    let afterRowId = ''
    for (;;) {
      const page = await repairUnknownProvenancePage(
        sql,
        UNKNOWN_PROVENANCE_REPAIR_BATCH_SIZE,
        afterRowId
      )
      if (page.candidates === 0 || page.lastRowId === null) break
      repaired += page.repaired
      skipped += page.candidates - page.repaired
      afterRowId = page.lastRowId
      console.log(`  repaired ${repaired} unknown table row(s)`)
    }
    console.log(
      `Unknown table row provenance repair complete: ${repaired} row(s) repaired, ${skipped} left to a concurrent writer.`
    )
  },
}
