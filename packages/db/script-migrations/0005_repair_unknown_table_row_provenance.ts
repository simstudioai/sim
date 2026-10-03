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
 * Takes the parent row lock before touching the sidecar, in `id` order, because that is the order
 * `mutateTableRowsWithSecretProvenance` takes them: it locks `user_table_rows` up front, then
 * upserts the sidecar inside the same transaction. Deleting the sidecar first and only then
 * updating the parent is the opposite order, so an overlapping write would deadlock — and Postgres
 * would resolve it by aborting either the deployment or somebody's table write. Sharing the
 * writer's order means the two serialize instead.
 *
 * Holding the parent lock is also what makes the status re-check below decisive rather than
 * racy: a provenance-aware write commits its exact sidecar and its version marker together under
 * that same lock, so once it is held the write is either wholly done or has not begun. Matching on
 * the id alone would drop a freshly exact sidecar and clear the marker behind it, leaving a
 * genuinely secret-bearing row reading as legacy — provenance destroyed by the repair meant to make
 * provenance safe.
 *
 * `secret_provenance_version` is not a column the demote trigger watches, so this leaves
 * `updated_at` alone and cannot disturb a concurrent write's sidecar binding.
 */
async function repairUnknownProvenancePage(
  sql: Sql,
  batchSize: number,
  afterRowId: string
): Promise<RepairPage> {
  const candidates = await sql<{ rowId: string }[]>`
    SELECT row_id AS "rowId"
    FROM user_table_row_secret_provenance
    WHERE status = 'unknown' AND row_id > ${afterRowId}
    ORDER BY row_id
    LIMIT ${batchSize}
  `
  if (candidates.length === 0) return { candidates: 0, repaired: 0, lastRowId: null }
  const rowIds = candidates.map((candidate) => candidate.rowId)

  const repaired = await sql.begin(async (tx) => {
    await tx`
      SELECT id FROM user_table_rows
      WHERE id = ANY(${rowIds}::text[])
      ORDER BY id
      FOR UPDATE
    `
    const cleared = await tx<{ rowId: string }[]>`
      DELETE FROM user_table_row_secret_provenance
      WHERE row_id = ANY(${rowIds}::text[])
        AND status = 'unknown'
      RETURNING row_id AS "rowId"
    `
    if (cleared.length === 0) return 0
    const marked = await tx<{ id: string }[]>`
      UPDATE user_table_rows
      SET secret_provenance_version = NULL
      WHERE id = ANY(${cleared.map((row) => row.rowId)}::text[])
      RETURNING id
    `
    return marked.length
  })

  return {
    candidates: rowIds.length,
    repaired: repaired as number,
    lastRowId: rowIds[rowIds.length - 1],
  }
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
export async function runUnknownTableRowProvenanceRepair(sql: Sql): Promise<void> {
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
}

export const repairUnknownTableRowProvenance: ScriptMigration = {
  name: '0005_repair_unknown_table_row_provenance',
  up: runUnknownTableRowProvenanceRepair,
}
