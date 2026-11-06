import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import { getTransientDatabaseFailure } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import type { Sql } from 'postgres'

const logger = createLogger('PublicShareEntityBackfill')
const BATCH_SIZE = 500
const MAX_BATCH_ATTEMPTS = 3
const MAX_REPAIR_SAMPLES = 10

/** Stamps verified legacy share owners without repairing ambiguous targets or changing tokens. */
export async function backfillPublicShareEntities(sql: Sql) {
  let afterId = ''
  let backfilled = 0
  for (;;) {
    const rows = await sql<{ id: string; resource_type: string; resource_id: string }[]>`
      SELECT id, resource_type, resource_id FROM public_share
      WHERE entity_type IS NULL AND entity_id IS NULL AND workspace_id IS NOT NULL
        AND id > ${afterId}
      ORDER BY id LIMIT ${BATCH_SIZE}
    `
    if (!rows.length) break
    const ids = rows.map((row) => row.id)
    const fileIds = [
      ...new Set(rows.filter((row) => row.resource_type === 'file').map((row) => row.resource_id)),
    ].sort()
    const started = performance.now()
    for (let attempt = 1; ; attempt++) {
      try {
        const updated = await sql.begin(async (tx) => {
          await tx`SELECT set_config('lock_timeout', '5s', true),
            set_config('statement_timeout', '30s', true)`
          // Target locks precede share locks, as they do for insertion and target retirement.
          if (fileIds.length)
            await tx`
        SELECT id FROM workspace_files WHERE id = ANY(${fileIds}::text[])
        ORDER BY id FOR UPDATE
      `
          return tx<{ id: string }[]>`
        UPDATE public_share share
        SET entity_type = 'workspace', entity_id = share.workspace_id
        WHERE share.id = ANY(${ids}::text[]) AND share.entity_type IS NULL AND share.entity_id IS NULL
          AND share.workspace_id IS NOT NULL
          AND (share.resource_type <> 'file' OR EXISTS (
            SELECT 1 FROM workspace_files file
            CROSS JOIN LATERAL workspace_file_owner(
              file.context, file.workspace_id, file.project_id, file.organization_id, file.user_id
            ) owner
            WHERE file.id = share.resource_id
              AND owner.entity_type = 'workspace'
              AND owner.entity_id = share.workspace_id
          ))
        RETURNING share.id
      `
        })
        backfilled += updated.length
        afterId = rows[rows.length - 1].id
        logger.info('Public share owner batch committed', {
          candidates: rows.length,
          backfilled: updated.length,
          attempts: attempt,
          durationMs: Math.round(performance.now() - started),
        })
        break
      } catch (error) {
        const failure = getTransientDatabaseFailure(error)
        if (attempt >= MAX_BATCH_ATTEMPTS || (failure !== 'capacity' && failure !== 'conflict'))
          throw error
        logger.warn('Retrying public share owner batch after transient contention', {
          attempt,
          failure,
        })
        await sleep(backoffWithJitter(attempt, null, { baseMs: 250, maxMs: 1000 }))
      }
    }
  }

  let unresolved = 0
  const sampleShareIds: string[] = []
  afterId = ''
  for (;;) {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM public_share
      WHERE (entity_type IS NULL OR entity_id IS NULL) AND id > ${afterId}
      ORDER BY id LIMIT ${BATCH_SIZE}
    `
    if (!rows.length) break
    afterId = rows[rows.length - 1].id
    unresolved += rows.length
    for (const row of rows) {
      if (sampleShareIds.length < MAX_REPAIR_SAMPLES) sampleShareIds.push(row.id)
    }
  }
  return { backfilled, unresolved, sampleShareIds }
}

export const backfillPublicShareEntitiesMigration: ScriptMigration = {
  name: '0034_backfill_public_share_entities',
  async up(sql) {
    const result = await backfillPublicShareEntities(sql)
    logger.info('Public share owner backfill completed', result)
    if (result.unresolved)
      logger.warn('Public shares require target repair before delivery', result)
  },
}
