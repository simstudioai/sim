import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import type { Sql } from 'postgres'

const logger = createLogger('FileFolderEntityBackfill')
const BATCH_SIZE = 500
const MAX_REPAIR_SAMPLES = 10

/** Backfills compatibility folder ownership; mismatched version scopes are reported without reassignment. */
export async function backfillFileFolderEntities(sql: Sql) {
  let afterFolderId = ''
  let backfilled = 0
  for (;;) {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM folder
      WHERE entity_type IS NULL AND entity_id IS NULL AND workspace_id IS NOT NULL
        AND id > ${afterFolderId}
      ORDER BY id LIMIT ${BATCH_SIZE}
    `
    if (!rows.length) break
    afterFolderId = rows[rows.length - 1].id
    const ids = rows.map((row) => row.id)
    const updated = await sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '5s'`
      await tx`SET LOCAL statement_timeout = '30s'`
      await tx`SELECT id FROM folder WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`
      return tx<{ id: string }[]>`
        UPDATE folder SET entity_type = entity_type
        WHERE id = ANY(${ids}::text[]) AND entity_type IS NULL AND entity_id IS NULL
          AND workspace_id IS NOT NULL
        RETURNING id
      `
    })
    backfilled += updated.length
  }

  let afterVersionId = ''
  let mismatchedVersions = 0
  const sampleVersionIds: string[] = []
  for (;;) {
    const rows = await sql<{ id: string; compatible: boolean }[]>`
      SELECT version.id,
        coalesce(
          (coalesce(file.entity_type, owner.entity_type) = 'workspace' AND file.context = 'workspace'
            AND version.workspace_id IS NOT DISTINCT FROM coalesce(file.entity_id, owner.entity_id))
          OR (file.entity_type = 'project' AND file.context = 'project' AND version.workspace_id IS NULL),
          false
        ) AS compatible
      FROM workspace_file_version version
      LEFT JOIN workspace_files file ON file.id = version.file_id
      LEFT JOIN LATERAL workspace_file_legacy_entity(
        file.context, file.workspace_id, file.organization_id, file.user_id
      ) owner ON true
      WHERE version.id > ${afterVersionId}
      ORDER BY version.id LIMIT ${BATCH_SIZE}
    `
    if (!rows.length) break
    afterVersionId = rows[rows.length - 1].id
    for (const row of rows) {
      if (row.compatible) continue
      mismatchedVersions += 1
      if (sampleVersionIds.length < MAX_REPAIR_SAMPLES) sampleVersionIds.push(row.id)
    }
  }

  return { backfilled, mismatchedVersions, sampleVersionIds }
}

export const backfillFileFolderEntitiesMigration: ScriptMigration = {
  name: '0031_backfill_file_folder_entities',
  async up(sql) {
    const result = await backfillFileFolderEntities(sql)
    logger.info('File folder entity backfill completed', result)
    if (result.mismatchedVersions) {
      throw new Error(
        'Retained file versions require ownership repair before continuing. Review the reported version IDs, repair their ownership explicitly, and rerun the migration.'
      )
    }
  },
}
