import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import type { Sql } from 'postgres'

const logger = createLogger('ProjectFileCreatorBackfill')
const BATCH_SIZE = 500

async function backfillTable(sql: Sql, table: 'workspace_files' | 'folder'): Promise<number> {
  let afterId = ''
  let backfilled = 0
  for (;;) {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM ${sql(table)}
      WHERE project_id IS NOT NULL AND original_creator_user_id IS NULL AND user_id IS NOT NULL
        AND id > ${afterId}
      ORDER BY id LIMIT ${BATCH_SIZE}
    `
    if (!rows.length) return backfilled
    afterId = rows[rows.length - 1].id
    const ids = rows.map((row) => row.id)
    const updated = await sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '5s'`
      await tx`SET LOCAL statement_timeout = '30s'`
      await tx`SELECT id FROM ${tx(table)} WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`
      return tx<{ id: string }[]>`
        UPDATE ${tx(table)} SET original_creator_user_id = user_id
        WHERE id = ANY(${ids}::text[]) AND project_id IS NOT NULL
          AND original_creator_user_id IS NULL AND user_id IS NOT NULL
        RETURNING id
      `
    })
    backfilled += updated.length
  }
}

/** Snapshots canonical Project creators without changing live references, ownership, or content. */
export async function backfillProjectFileCreators(sql: Sql) {
  return {
    files: await backfillTable(sql, 'workspace_files'),
    folders: await backfillTable(sql, 'folder'),
  }
}

export const backfillProjectFileCreatorsMigration: ScriptMigration = {
  name: '0032_backfill_project_file_creators',
  async up(sql) {
    logger.info('Project file creator backfill completed', await backfillProjectFileCreators(sql))
  },
}
