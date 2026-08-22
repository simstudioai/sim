import type { Sql } from 'postgres'
import type { ScriptMigration } from './types'

export const UNKNOWN_FILE_PROVENANCE_REPAIR_BATCH_SIZE = 1000

interface RepairPage {
  candidates: number
  repaired: number
  lastFileId: string | null
}

/**
 * Returns one page of files the reader calls `unrecorded` to the untracked state.
 *
 * The predicate is the reader's own, condition for condition: version 1, a sidecar bound to the
 * file's current bytes, a well-formed entries array, and a status of `unknown`. That is precisely
 * the branch `getBoundWorkspaceFileSecretProvenance` answers `unrecorded` to, and a status-only
 * query is wider than it. A sidecar left bound to bytes the file no longer holds reads as `unknown`
 * — a fault the surface refuses and no policy relaxes — but clearing it here would set
 * `secret_provenance_version` to NULL, and a NULL version reads as *exact-empty*: the file would go
 * from refused to positively vouched for, silently and with no audit entry, on the strength of a
 * sidecar that described different bytes. Relaxing an absence is this migration's whole purpose;
 * promoting a fault is not, and the same three conditions guard the delete so the distinction
 * cannot be lost to a concurrent write.
 *
 * Takes the parent row lock before touching the sidecar, in `id` order, because that is the order
 * a content write takes them: `workspace-file-manager` updates `workspace_files` and only then
 * replaces the sidecar, inside the same transaction. Deleting the sidecar first and updating the
 * parent after is the opposite order, so an overlapping upload would deadlock and Postgres would
 * resolve it by aborting either the deployment or somebody's file write.
 *
 * Holding that lock is also what makes the re-check decisive: a content write moves
 * `content_updated_at` and rewrites the sidecar under the same lock, so once it is held the write
 * is either wholly done or has not begun, and a file it has meanwhile made exact or rebound stops
 * matching.
 */
async function repairUnknownFileProvenancePage(
  sql: Sql,
  batchSize: number,
  afterFileId: string
): Promise<RepairPage> {
  const candidates = await sql<{ fileId: string }[]>`
    SELECT p.file_id AS "fileId"
    FROM workspace_file_secret_provenance p
    JOIN workspace_files f ON f.id = p.file_id
    WHERE p.status = 'unknown'
      AND f.secret_provenance_version = 1
      AND p.content_updated_at = f.content_updated_at
      AND jsonb_typeof(p.entries) = 'array'
      AND p.file_id > ${afterFileId}
    ORDER BY p.file_id
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
      DELETE FROM workspace_file_secret_provenance p
      USING workspace_files f
      WHERE p.file_id = f.id
        AND p.file_id = ANY(${fileIds}::text[])
        AND p.status = 'unknown'
        AND f.secret_provenance_version = 1
        AND p.content_updated_at = f.content_updated_at
        AND jsonb_typeof(p.entries) = 'array'
      RETURNING p.file_id AS "fileId"
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
 * Files whose sidecar is stale, unversioned, or malformed are faults rather than absences: they
 * stay refused, exactly as the surface refuses them, and recover the way they always have — on the
 * next content write, which rebinds the sidecar. Idempotent: a repaired file has no sidecar row, so
 * it leaves the candidate set and a re-run costs one empty query.
 *
 * One-time amnesty, and deliberately so. Until the release that ships this, storage collapsed two
 * different claims into `unknown`: bytes nobody recorded, and bytes a writer refused on purpose —
 * a child of a secret-bearing archive, a generated asset whose safety decision came back false.
 * Writers now record those separately, so the distinction holds from here on and this population
 * cannot grow. It cannot be recovered retroactively, though: the rows that already exist do not say
 * which they were, and no column separates them. Clearing them therefore accepts that a few may
 * have been refusals rather than absences — an accepted risk for a bounded, days-old population on
 * a feature with no dependents yet, taken so the workspaces holding unusable files recover.
 *
 * Runs before the image that ships the distinction is promoted, so the rows it sees are exactly the
 * collapsed legacy population and none of the ones written afterwards.
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
