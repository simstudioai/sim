import type { Sql } from 'postgres'
import type { ScriptMigration } from './types'

export const UNKNOWN_FILE_PROVENANCE_REPAIR_BATCH_SIZE = 1000

interface RepairPage {
  candidates: number
  repaired: number
  lastFileId: string | null
}

/**
 * Returns one page of `unknown` files to the untracked state.
 *
 * Takes the parent row lock before touching the sidecar, in `id` order, because that is the order
 * a content write takes them: `workspace-file-manager` updates `workspace_files` and only then
 * replaces the sidecar, inside the same transaction. Deleting the sidecar first and updating the
 * parent after is the opposite order, so an overlapping upload would deadlock and Postgres would
 * resolve it by aborting either the deployment or somebody's file write.
 *
 * Holding that lock is also what makes the status re-check decisive: a content write moves
 * `content_updated_at` and rewrites the sidecar under the same lock, so once it is held the write
 * is either wholly done or has not begun, and a file it has meanwhile made exact stops matching.
 */
async function repairUnknownFileProvenancePage(
  sql: Sql,
  batchSize: number,
  afterFileId: string
): Promise<RepairPage> {
  const candidates = await sql<{ fileId: string }[]>`
    SELECT file_id AS "fileId"
    FROM workspace_file_secret_provenance
    WHERE status = 'unknown' AND file_id > ${afterFileId}
    ORDER BY file_id
    LIMIT ${batchSize}
  `
  if (candidates.length === 0) return { candidates: 0, repaired: 0, lastFileId: null }
  const fileIds = candidates.map((candidate) => candidate.fileId)

  const repaired = await sql.begin(async (tx) => {
    await tx`
      SELECT id FROM workspace_files
      WHERE id = ANY(${fileIds}::text[])
      ORDER BY id
      FOR UPDATE
    `
    const cleared = await tx<{ fileId: string }[]>`
      DELETE FROM workspace_file_secret_provenance
      WHERE file_id = ANY(${fileIds}::text[])
        AND status = 'unknown'
      RETURNING file_id AS "fileId"
    `
    if (cleared.length === 0) return 0
    const marked = await tx<{ id: string }[]>`
      UPDATE workspace_files
      SET secret_provenance_version = NULL
      WHERE id = ANY(${cleared.map((row) => row.fileId)}::text[])
      RETURNING id
    `
    return marked.length
  })

  return {
    candidates: fileIds.length,
    repaired: repaired as number,
    lastFileId: fileIds[fileIds.length - 1],
  }
}

/**
 * Restores files whose secret provenance nobody recorded to the untracked state.
 *
 * These files were unreadable. A workspace file reading `unknown` was refused by every model and
 * runtime boundary at once — attachments, mounts, and the tool routes that parse, transcribe or
 * describe a file — while a file that was never tracked at all returned exact-empty and worked
 * fine. The two say the same thing about their contents, which is nothing, so the second was a
 * permanent penalty for having tried to record provenance and failed.
 *
 * The surface now reads such a file and records an audit entry instead, which is what the other
 * durable surfaces already do. That fixes the behaviour going forward but not the files already in
 * the state, which would otherwise report on every read forever; this clears them so the trail
 * carries only what happens next.
 *
 * A relabel, not a reconstruction. It claims strictly less than the sidecar did — "unrecorded" —
 * and puts the file exactly where the untracked file beside it already sits. Idempotent: a repaired
 * file has no sidecar row, so it leaves the candidate set and a re-run costs one empty query.
 */
export const repairUnknownWorkspaceFileProvenance: ScriptMigration = {
  name: '0007_repair_unknown_workspace_file_provenance',
  async up(sql: Sql): Promise<void> {
    let repaired = 0
    let skipped = 0
    let afterFileId = ''
    for (;;) {
      const page = await repairUnknownFileProvenancePage(
        sql,
        UNKNOWN_FILE_PROVENANCE_REPAIR_BATCH_SIZE,
        afterFileId
      )
      if (page.candidates === 0 || page.lastFileId === null) break
      repaired += page.repaired
      skipped += page.candidates - page.repaired
      afterFileId = page.lastFileId
    }
    console.log(
      `Unknown workspace file provenance repair complete: ${repaired} file(s) repaired, ${skipped} left to a concurrent writer.`
    )
  },
}
