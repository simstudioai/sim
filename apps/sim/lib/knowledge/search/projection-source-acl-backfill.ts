import { resolveDbUrl } from '@sim/db'
import {
  backfillProjectionSourceAcl,
  PROJECTION_SOURCE_ACL_BACKFILL_OUTBOX_EVENT,
  PROJECTION_SOURCE_ACL_TABLES,
  type ProjectionSourceAclTable,
} from '@sim/db/script-migrations/0021_embedding_search_connector'
import { createLogger } from '@sim/logger'
import postgres from 'postgres'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import { env } from '@/lib/core/config/env'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import {
  continueOutboxHandler,
  type DeferredOutboxHandlerResult,
  type OutboxEventContext,
  type OutboxHandlerRegistry,
  withOutboxHandlerTimeout,
} from '@/lib/core/outbox/service'

const logger = createLogger('ProjectionSourceAclBackfill')

export const PROJECTION_SOURCE_ACL_BACKFILL_TASK_ID = 'projection-source-acl-backfill'

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
    return null
  } finally {
    await sql.end()
  }
}

/** Whether the deployment has a Trigger.dev worker to hand the backfill to. */
export function projectionSourceAclBackfillUsesTrigger(): boolean {
  return Boolean(isTriggerDevEnabled && env.TRIGGER_SECRET_KEY)
}

/**
 * Starts the backfill the way the table backfill is started: on the deployment's Trigger.dev
 * worker, where bounded runs chain until both projections are filled. Safe to call again at any
 * time — a run only fills rows still unset.
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

/** One outbox run's share of the backfill on a deployment without a worker, inside its window. */
const OUTBOX_RUN_BUDGET_MS = 4 * 60 * 1000
const OUTBOX_HANDLER_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Handles the event script migration `0021_embedding_search_connector` leaves behind, so the
 * backfill starts once the app that ships this handler is up, on every deployment. With a
 * Trigger.dev worker the event is done once the task is enqueued: the task owns its own retries
 * and continuations. Without one the backfill runs here, one bounded slice per outbox run, and the
 * event stays pending until both projections are filled — every slice's writes are durable, and a
 * slice that starts over after a restart skips the filled rows through the unfilled index, so an
 * interrupted deployment loses nothing but the time of one slice.
 */
export const projectionSourceAclBackfillOutboxHandlers: OutboxHandlerRegistry = {
  [PROJECTION_SOURCE_ACL_BACKFILL_OUTBOX_EVENT]: withOutboxHandlerTimeout(
    async (
      _payload: unknown,
      _context: OutboxEventContext
    ): Promise<undefined | DeferredOutboxHandlerResult> => {
      if (projectionSourceAclBackfillUsesTrigger()) {
        await enqueueProjectionSourceAclBackfill()
        return undefined
      }
      const cursor = await runProjectionSourceAclBackfill({}, { budgetMs: OUTBOX_RUN_BUDGET_MS })
      if (!cursor) return undefined
      return continueOutboxHandler(
        `projection source and ACL backfill paused at ${cursor.projection} after ${cursor.afterId}`
      )
    },
    OUTBOX_HANDLER_TIMEOUT_MS
  ),
}
