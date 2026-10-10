import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import type { Sql } from 'postgres'

const logger = createLogger('FileOwnershipValidation')
const BATCH_SIZE = 500
const MAX_REPAIR_SAMPLES = 10

/** Validates existing typed owners and retained version bindings without rewriting ownership. */
export async function validateFileOwnership(sql: Sql) {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '5s'`
    await tx`ALTER TABLE workspace_files
      VALIDATE CONSTRAINT workspace_files_project_id_project_id_fk,
      VALIDATE CONSTRAINT workspace_files_owner_check,
      VALIDATE CONSTRAINT workspace_files_project_binding_check`
    await tx`ALTER TABLE folder
      VALIDATE CONSTRAINT folder_project_id_project_id_fk,
      VALIDATE CONSTRAINT folder_owner_check`
  })

  let afterVersionId = ''
  let mismatchedVersions = 0
  const sampleVersionIds: string[] = []
  for (;;) {
    const rows = await sql<{ id: string; compatible: boolean }[]>`
      SELECT version.id,
        coalesce(
          (file.workspace_id IS NOT NULL AND file.project_id IS NULL AND file.organization_id IS NULL AND file.context IN ('workspace', 'test', 'changelog')
            AND version.workspace_id IS NOT DISTINCT FROM file.workspace_id)
          OR (file.project_id IS NOT NULL AND file.context = 'project' AND version.workspace_id IS NULL),
          false
        ) AS compatible
      FROM workspace_file_version version
      LEFT JOIN workspace_files file ON file.id = version.file_id
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

  return { mismatchedVersions, sampleVersionIds }
}

export const validateFileOwnershipMigration: ScriptMigration = {
  name: '0031_validate_file_ownership',
  async up(sql) {
    const result = await validateFileOwnership(sql)
    logger.info('File ownership validation completed', result)
    if (result.mismatchedVersions) {
      throw new Error(
        'Retained file versions require ownership repair before continuing. Review the reported version IDs, repair their ownership explicitly, and rerun the migration.'
      )
    }
  },
}
