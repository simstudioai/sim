import { resolveDbUrl } from '@sim/db'
import {
  backfillProjectionSourceAcl,
  PROJECTION_SOURCE_ACL_TABLES,
  type ProjectionSourceAclTable,
} from '@sim/db/script-migrations/0021_embedding_search_connector'
import { createLogger } from '@sim/logger'
import postgres from 'postgres'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import { prewarmSearchProjection } from '@/lib/knowledge/search/prewarm'

const logger = createLogger('ProjectionSourceAclBackfill')

export const PROJECTION_SOURCE_ACL_BACKFILL_TASK_ID = 'projection-source-acl-backfill'

/**
 * Ceiling on warming the projections after the fill. It sits inside the headroom the worker
 * keeps beyond a run's fill budget, so a slow read of a large projection can never carry the
 * completed run past the worker's limit and repeat the fill on retry.
 */
export const PROJECTION_PREWARM_BUDGET_MS = 15 * 60 * 1000

/** Where a run stopped, so the next one carries on from there instead of rescanning. */
export interface ProjectionSourceAclBackfillCursor {
  projection: ProjectionSourceAclTable
  afterId: string
}

export interface ProjectionSourceAclBackfillPayload {
  /** The first projection's first page when absent. */
  cursor?: ProjectionSourceAclBackfillCursor
  pageSize?: number
  pauseMs?: number
}

export interface ProjectionSourceAclBackfillRunOptions {
  /** Stop once this much time has passed and return where to resume; unbounded otherwise. */
  budgetMs?: number
}

/**
 * Fills the ranking projections' source and ACL columns from the cursor onwards, one projection
 * after the other, on a connection of its own: the page statement binds the keyset cursor as a
 * scalar and needs no array parameter, so the pool's options would serve, but a run this long
 * should not hold one of the worker's pooled connections. Returns the cursor to continue from when
 * the budget ran out, `null` once both projections are filled.
 */
export async function runProjectionSourceAclBackfill(
  payload: ProjectionSourceAclBackfillPayload,
  options: ProjectionSourceAclBackfillRunOptions = {}
): Promise<ProjectionSourceAclBackfillCursor | null> {
  const url = resolveDbUrl('DATABASE_URL', process.env.SIM_DB_ROLE?.trim() || 'web')
  if (!url) throw new Error('DATABASE_URL is required to backfill the projection source and ACL')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  const startedAt = Date.now()
  try {
    const start = payload.cursor
      ? PROJECTION_SOURCE_ACL_TABLES.indexOf(payload.cursor.projection)
      : 0
    if (start < 0) throw new Error(`Unknown projection ${payload.cursor?.projection}`)
    for (const projection of PROJECTION_SOURCE_ACL_TABLES.slice(start)) {
      const budgetMs =
        options.budgetMs === undefined
          ? undefined
          : Math.max(0, options.budgetMs - (Date.now() - startedAt))
      const progress = await backfillProjectionSourceAcl(sql, projection, {
        afterId: payload.cursor?.projection === projection ? payload.cursor.afterId : undefined,
        pageSize: payload.pageSize,
        pauseMs: payload.pauseMs,
        budgetMs,
      })
      if (!progress.done) return { projection, afterId: progress.afterId }
    }
    logger.info('Projection source and ACL backfill complete', {
      elapsedMs: Date.now() - startedAt,
    })
    /** The fill just streamed through both projections; put the ranking pages back before anyone searches. */
    await prewarmSearchProjection(sql, { budgetMs: PROJECTION_PREWARM_BUDGET_MS })
    return null
  } finally {
    await sql.end()
  }
}

/**
 * Starts the backfill on the deployment's Trigger.dev worker, where bounded runs chain until both
 * projections are filled. Safe to call again at any time: a run only fills rows still unset.
 */
export async function enqueueProjectionSourceAclBackfill(
  payload: ProjectionSourceAclBackfillPayload = {}
): Promise<{ runId: string }> {
  const { tasks } = await import('@trigger.dev/sdk')
  const handle = await tasks.trigger(PROJECTION_SOURCE_ACL_BACKFILL_TASK_ID, payload, {
    region: await resolveTriggerRegion(),
  })
  logger.info('Projection source and ACL backfill enqueued', { runId: handle.id })
  return { runId: handle.id }
}
