import type { Sql } from 'postgres'
import type { ScriptMigration } from './types'

export const CONTENT_REVISION_REPAIR_BATCH_SIZE = 1000

interface RepairPage {
  scanned: number
  repaired: number
  lastFileId: string | null
}

/**
 * Repairs one page of revisions stored with sub-millisecond precision.
 *
 * `content_updated_at` must be millisecond-precise; the column's TSDoc in `packages/db/schema.ts` has why
 * a sub-millisecond revision strands a file as permanently unindexed. Migration 0357 stops new ones being
 * minted; these are the rows that predate it, almost all stamped by the `DEFAULT now()` that added the
 * column.
 *
 * Scoped to `context = 'workspace'`, live and soft-deleted: those are the rows the search index keys on,
 * and a soft-deleted row is restored by paths that do not rewrite `content_updated_at`, which would
 * re-enter the broken state. Other contexts are never search-indexed and only ever compare this column in
 * JavaScript, where both sides are already millisecond; the 0357 trigger normalizes them on their next
 * content write rather than rewriting millions of rows here.
 *
 * Keyset by `id` so each page continues along the primary key instead of re-scanning the rows earlier
 * pages already repaired — the predicate itself cannot use an index.
 *
 * The whole page is one transaction because `workspace_files_secret_provenance_demote` nulls
 * `secret_provenance_version` on any change to `content_updated_at`. Truncation keeps the same content
 * and the sidecar moves with it, so the tracked version is restored rather than left demoted to the
 * legacy untracked state — and a crash between the two would otherwise lose it permanently. Locks the
 * parent rows in `id` order first, the order a content write takes them, so an overlapping upload waits
 * instead of deadlocking.
 */
async function repairContentRevisionPage(
  sql: Sql,
  batchSize: number,
  afterFileId: string
): Promise<RepairPage> {
  const candidates = await sql<{ fileId: string }[]>`
    SELECT id AS "fileId"
    FROM workspace_files
    WHERE context = 'workspace'
      AND content_updated_at <> date_trunc('milliseconds', content_updated_at)
      AND id > ${afterFileId}
    ORDER BY id
    LIMIT ${batchSize}
  `
  if (candidates.length === 0) return { scanned: 0, repaired: 0, lastFileId: null }
  const fileIds = candidates.map((candidate) => candidate.fileId)
  const lastFileId = fileIds[fileIds.length - 1]

  const repaired = await sql.begin(async (tx) => {
    const tracked = await tx<{ fileId: string; version: number | null }[]>`
      SELECT id AS "fileId", secret_provenance_version AS version
      FROM workspace_files
      WHERE id = ANY(${fileIds}::text[])
      ORDER BY id
      FOR UPDATE
    `
    const rewritten = await tx<{ fileId: string }[]>`
      UPDATE workspace_files
      SET content_updated_at = date_trunc('milliseconds', content_updated_at)
      WHERE id = ANY(${fileIds}::text[])
        AND context = 'workspace'
        AND content_updated_at <> date_trunc('milliseconds', content_updated_at)
      RETURNING id AS "fileId"
    `
    if (rewritten.length === 0) return 0
    const rewrittenIds = rewritten.map((row) => row.fileId)

    await tx`
      UPDATE workspace_file_secret_provenance
      SET content_updated_at = date_trunc('milliseconds', content_updated_at)
      WHERE file_id = ANY(${rewrittenIds}::text[])
        AND content_updated_at <> date_trunc('milliseconds', content_updated_at)
    `

    const rewrittenIdSet = new Set(rewrittenIds)
    const restorable = tracked.filter(
      (row): row is { fileId: string; version: number } =>
        row.version !== null && rewrittenIdSet.has(row.fileId)
    )
    if (restorable.length > 0) {
      await tx`
        UPDATE workspace_files AS file
        SET secret_provenance_version = restored.version
        FROM unnest(
          ${restorable.map((row) => row.fileId)}::text[],
          ${restorable.map((row) => row.version)}::integer[]
        ) AS restored(file_id, version)
        WHERE file.id = restored.file_id
          AND file.secret_provenance_version IS DISTINCT FROM restored.version
      `
    }

    // These match no file row, so nothing can claim them, while an outstanding one still holds a slice
    // of its workspace's dispatch budget until the stale-claim reaper runs.
    await tx`
      DELETE FROM workspace_file_search_segment AS segment
      USING workspace_files AS file
      WHERE segment.file_id = file.id
        AND segment.file_id = ANY(${rewrittenIds}::text[])
        AND segment.source_content_updated_at <> file.content_updated_at
        AND date_trunc('milliseconds', segment.source_content_updated_at) = file.content_updated_at
    `
    await tx`
      DELETE FROM workspace_file_search_index AS search_index
      USING workspace_files AS file
      WHERE search_index.file_id = file.id
        AND search_index.file_id = ANY(${rewrittenIds}::text[])
        AND search_index.source_content_updated_at <> file.content_updated_at
        AND date_trunc('milliseconds', search_index.source_content_updated_at) =
          file.content_updated_at
    `
    return rewritten.length
  })

  return { scanned: candidates.length, repaired, lastFileId }
}

export async function repairWorkspaceFileContentRevisions(
  sql: Sql,
  batchSize: number = CONTENT_REVISION_REPAIR_BATCH_SIZE
): Promise<number> {
  let afterFileId = ''
  let repaired = 0
  for (;;) {
    const page = await repairContentRevisionPage(sql, batchSize, afterFileId)
    if (page.scanned === 0 || page.lastFileId === null) return repaired
    repaired += page.repaired
    afterFileId = page.lastFileId
  }
}

export const repairWorkspaceFileContentRevisionMigration: ScriptMigration = {
  name: '0018_repair_workspace_file_content_revision',
  async up(sql) {
    await repairWorkspaceFileContentRevisions(sql)
  },
}
