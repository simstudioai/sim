import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import type { Sql } from 'postgres'

const logger = createLogger('FileEntityBackfill')
const BATCH_SIZE = 500
const MAX_REPAIR_SAMPLES = 10

interface UnresolvedContext {
  context: string
  count: number
  sampleFileIds: string[]
}

/** Populates only audited legacy owners without changing file identities, bytes, or revisions. */
export async function backfillWorkspaceFileEntities(sql: Sql) {
  let afterFileId = ''
  let scanned = 0
  let backfilled = 0
  const unresolved = new Map<string, UnresolvedContext>()

  for (;;) {
    const rows = await sql<
      { id: string; context: string; mappedType: string | null; mappedId: string | null }[]
    >`
      SELECT file.id, file.context, owner.entity_type AS "mappedType", owner.entity_id AS "mappedId"
      FROM workspace_files file
      CROSS JOIN LATERAL workspace_file_legacy_entity(
        file.context, file.workspace_id, file.organization_id, file.user_id
      ) owner
      WHERE file.entity_type IS NULL AND file.entity_id IS NULL AND file.id > ${afterFileId}
      ORDER BY file.id
      LIMIT ${BATCH_SIZE}
    `
    if (!rows.length) break
    afterFileId = rows[rows.length - 1].id
    scanned += rows.length

    for (const row of rows) {
      if (row.mappedType && row.mappedId) continue
      let summary = unresolved.get(row.context)
      if (!summary) {
        summary = { context: row.context, count: 0, sampleFileIds: [] }
        unresolved.set(row.context, summary)
      }
      summary.count += 1
      if (summary.sampleFileIds.length < MAX_REPAIR_SAMPLES) summary.sampleFileIds.push(row.id)
    }

    const ids = rows.filter((row) => row.mappedType && row.mappedId).map((row) => row.id)
    if (!ids.length) continue
    const updated = await sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '5s'`
      await tx`SET LOCAL statement_timeout = '30s'`
      /** Lock in key order; the trigger derives from the current row after concurrent legacy writes. */
      await tx`
        SELECT id FROM workspace_files WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE
      `
      return tx<{ id: string }[]>`
        UPDATE workspace_files AS file SET entity_type = file.entity_type
        WHERE file.id = ANY(${ids}::text[])
          AND file.entity_type IS NULL AND file.entity_id IS NULL
          AND EXISTS (
            SELECT 1 FROM workspace_file_legacy_entity(
              file.context, file.workspace_id, file.organization_id, file.user_id
            ) owner WHERE owner.entity_type IS NOT NULL AND owner.entity_id IS NOT NULL
          )
        RETURNING file.id
      `
    })
    backfilled += updated.length
  }

  return { scanned, backfilled, unresolved: [...unresolved.values()] }
}

export const backfillWorkspaceFileEntitiesMigration: ScriptMigration = {
  name: '0030_backfill_workspace_file_entities',
  async up(sql) {
    const result = await backfillWorkspaceFileEntities(sql)
    logger.info('File entity ownership backfill completed', result)
    if (result.unresolved.length) {
      logger.warn('Unresolved legacy file owners remain unavailable to entity-scoped operations', {
        unresolved: result.unresolved,
      })
    }
  },
}
