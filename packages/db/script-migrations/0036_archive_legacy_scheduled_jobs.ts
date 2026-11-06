import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import type { Sql } from 'postgres'

const logger = createLogger('ArchiveLegacyScheduledJobs')

export const ARCHIVE_LEGACY_SCHEDULED_JOBS_BATCH_SIZE = 500

/**
 * Archives every scheduled job written before jobs returned. Their prompts, chats and
 * completion protocol belong to the retired Go runner (removed in #6241), so none may start
 * running once the schedule tick claims jobs again. Rows are archived, never deleted: their
 * run logs stay readable. Each batch commits alone, keyed on id, so any count finishes and a
 * re-run after a crash picks up where it stopped. A completed job keeps its status.
 */
export async function archiveLegacyScheduledJobs(
  sql: Sql,
  batchSize = ARCHIVE_LEGACY_SCHEDULED_JOBS_BATCH_SIZE
): Promise<number> {
  let archived = 0
  let afterId = ''
  for (;;) {
    const rows = await sql<{ id: string }[]>`
      UPDATE workflow_schedule
      SET archived_at = now(),
          status = CASE WHEN status = 'completed' THEN status ELSE 'disabled' END,
          updated_at = now()
      WHERE id IN (
        SELECT id FROM workflow_schedule
        WHERE source_type = 'job' AND archived_at IS NULL AND id > ${afterId}
        ORDER BY id
        LIMIT ${batchSize}
      )
        AND source_type = 'job'
        AND archived_at IS NULL
      RETURNING id
    `
    if (rows.length === 0) break
    archived += rows.length
    afterId = rows.reduce((last, row) => (row.id > last ? row.id : last), afterId)
  }
  return archived
}

export const archiveLegacyScheduledJobsMigration: ScriptMigration = {
  name: '0036_archive_legacy_scheduled_jobs',
  async up(sql) {
    const archived = await archiveLegacyScheduledJobs(sql)
    logger.info('Archived legacy scheduled jobs', { archived })
  },
}
