import type { Sql } from 'postgres'
import type { ScriptMigration } from './types'

export const WORKSPACE_FILE_SIZE_BYTES_BATCH_SIZE = 1000

export interface WorkspaceFileSizeBytesBackfillStore {
  listCandidateIds(afterId: string, limit: number): Promise<string[]>
  backfillCandidateIds(ids: readonly string[]): Promise<number>
}

interface WorkspaceFileSizeBytesBackfillOptions {
  batchSize?: number
}

/** Backfills null size_bytes rows in bounded, independently committed keyset pages. */
export async function backfillWorkspaceFileSizeBytes(
  store: WorkspaceFileSizeBytesBackfillStore,
  options: WorkspaceFileSizeBytesBackfillOptions = {}
): Promise<number> {
  const batchSize = options.batchSize ?? WORKSPACE_FILE_SIZE_BYTES_BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('Workspace file size_bytes backfill batch size must be a positive integer')
  }

  let afterId = ''
  let backfilled = 0
  for (;;) {
    const ids = await store.listCandidateIds(afterId, batchSize)
    if (ids.length === 0) return backfilled
    if (ids.length > batchSize) {
      throw new Error('Workspace file size_bytes backfill store returned an oversized page')
    }
    const lastId = ids.at(-1)
    if (!lastId || lastId <= afterId) {
      throw new Error('Workspace file size_bytes backfill store returned a non-advancing page')
    }
    backfilled += await store.backfillCandidateIds(ids)
    afterId = lastId
  }
}

/** Creates the PostgreSQL store used by the deploy-time backfill. */
export function createPostgresWorkspaceFileSizeBytesBackfillStore(
  sql: Sql
): WorkspaceFileSizeBytesBackfillStore {
  return {
    async listCandidateIds(afterId, limit) {
      const rows = await sql<Array<{ id: string }>>`
        SELECT id
        FROM workspace_files
        WHERE id > ${afterId}
          AND size_bytes IS NULL
        ORDER BY id
        LIMIT ${limit}
      `
      return rows.map((row) => row.id)
    },

    async backfillCandidateIds(ids) {
      if (ids.length === 0) return 0
      return sql.begin(async (tx) => {
        const rows = await tx<Array<{ id: string }>>`
          UPDATE workspace_files
          SET size_bytes = size
          WHERE id = ANY(${ids}::text[])
            AND size_bytes IS NULL
          RETURNING id
        `
        return rows.length
      })
    },
  }
}

export const backfillWorkspaceFileSizeBytesMigration: ScriptMigration = {
  name: '0008_backfill_workspace_file_size_bytes',
  async up(sql) {
    const backfilled = await backfillWorkspaceFileSizeBytes(
      createPostgresWorkspaceFileSizeBytesBackfillStore(sql)
    )
    console.log(`Workspace file size_bytes backfill complete: ${backfilled} file(s) updated.`)
  },
}
