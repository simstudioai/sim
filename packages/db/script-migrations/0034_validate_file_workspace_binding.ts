import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'

const logger = createLogger('FileWorkspaceBindingValidation')

/** Requires explicit repair of legacy ownership before validating the write-time constraint. */
export const validateFileWorkspaceBindingMigration: ScriptMigration = {
  name: '0034_validate_file_workspace_binding',
  async up(sql) {
    const invalid = await sql<{ id: string; context: string }[]>`
      SELECT id, context FROM workspace_files
      WHERE context IN ('workspace', 'chat', 'mothership', 'execution', 'workspace-logos')
        AND workspace_id IS NULL
      ORDER BY id LIMIT 10
    `
    if (invalid.length) {
      logger.error('Workspace-scoped files require explicit ownership repair', { files: invalid })
      throw new Error(
        'Workspace-scoped files are missing workspace_id. Review the reported file IDs, establish their canonical workspace from authoritative records, repair explicitly, and rerun. Do not infer ownership from the uploader.'
      )
    }
    await sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '5s'`
      await tx`ALTER TABLE workspace_files
        VALIDATE CONSTRAINT workspace_files_workspace_binding_check`
    })
  },
}
