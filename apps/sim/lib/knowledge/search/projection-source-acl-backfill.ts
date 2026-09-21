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

/**
 * One of `count` equal slices of the chunk id space. Chunk ids are lowercase hex UUIDs, so the
 * space is sliced on the first hex digit and `count` must divide sixteen; every slice is a
 * contiguous id range, so workers on different slices never fill the same page.
 */
export interface ProjectionSourceAclBackfillShard {
  index: number
  count: number
}

export interface ProjectionSourceAclBackfillPayload {
  /** The first projection's first page when absent. */
  cursor?: ProjectionSourceAclBackfillCursor
  /** The whole id space when absent. */
  shard?: ProjectionSourceAclBackfillShard
  pageSize?: number
  pauseMs?: number
}

/** Refuses a shard the id space cannot be sliced into. */
function assertProjectionSourceAclShard({ index, count }: ProjectionSourceAclBackfillShard): void {
  if (!Number.isInteger(count) || count < 1 || 16 % count !== 0) {
    throw new Error(`Projection backfill shard count must divide 16, got ${count}`)
  }
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(`Projection backfill shard index must be within 0..${count - 1}, got ${index}`)
  }
}

/** The id range a shard covers: the id its first page follows, and the first id past it. */
export function projectionSourceAclShardRange(shard: ProjectionSourceAclBackfillShard): {
  afterId: string
  beforeId: string | undefined
} {
  assertProjectionSourceAclShard(shard)
  const { index, count } = shard
  const width = 16 / count
  const digit = (value: number) => value.toString(16)
  return {
    afterId: index === 0 ? '' : digit(index * width),
    beforeId: index + 1 < count ? digit((index + 1) * width) : undefined,
  }
}

export interface ProjectionSourceAclBackfillRunOptions {
  /** Stop once this much time has passed and return where to resume; unbounded otherwise. */
  budgetMs?: number
}

/**
 * Fills the ranking projections' source and ACL columns from the cursor onwards, one projection
 * after the other, on a connection of its own: the page statement binds the keyset cursor as a
 * scalar and needs no array parameter, so the pool's options would serve, but a run this long
 * should not hold one of the worker's pooled connections. A shard fills its own slice of the id
 * space in every projection. Returns the cursor to continue from when the budget ran out, `null`
 * once the run's range is filled in both projections.
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
    const range = payload.shard ? projectionSourceAclShardRange(payload.shard) : undefined
    for (const projection of PROJECTION_SOURCE_ACL_TABLES.slice(start)) {
      const budgetMs =
        options.budgetMs === undefined
          ? undefined
          : Math.max(0, options.budgetMs - (Date.now() - startedAt))
      const progress = await backfillProjectionSourceAcl(sql, projection, {
        afterId:
          payload.cursor?.projection === projection ? payload.cursor.afterId : range?.afterId,
        beforeId: range?.beforeId,
        pageSize: payload.pageSize,
        pauseMs: payload.pauseMs,
        budgetMs,
      })
      if (!progress.done) return { projection, afterId: progress.afterId }
    }
    logger.info('Projection source and ACL backfill complete', {
      shard: payload.shard,
      elapsedMs: Date.now() - startedAt,
    })
    /**
     * The fill just streamed through both projections; put the ranking pages back before anyone
     * searches. With shards, the one that finishes last does it: a shard that still finds unfilled
     * rows anywhere leaves the warm to whoever fills them. Two shards ending in the same moment can
     * both read none left and both warm, which repeats reads and nothing else.
     */
    if (await projectionsFilled(sql)) {
      await prewarmSearchProjection(sql, { budgetMs: PROJECTION_PREWARM_BUDGET_MS })
    }
    return null
  } finally {
    await sql.end()
  }
}

/** Whether no projection still holds a row without its source and ACL; each read is one index probe. */
async function projectionsFilled(sql: postgres.Sql): Promise<boolean> {
  for (const projection of PROJECTION_SOURCE_ACL_TABLES) {
    const [row] = await sql.unsafe<Array<{ unfilled: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM ${projection} WHERE acl IS NULL) AS unfilled`
    )
    if (row?.unfilled) return false
  }
  return true
}

/**
 * Starts the backfill on the deployment's Trigger.dev worker, where bounded runs chain until the
 * projections are filled: one chain over the whole id space, or one per shard, each filling its
 * own slice at the same time. Safe to call again at any time: a run only fills rows still unset.
 */
export async function enqueueProjectionSourceAclBackfill(
  payload: ProjectionSourceAclBackfillPayload = {},
  shards = 1
): Promise<{ runIds: string[] }> {
  const { tasks } = await import('@trigger.dev/sdk')
  const region = await resolveTriggerRegion()
  if (shards !== 1) assertProjectionSourceAclShard({ index: 0, count: shards })
  const payloads: ProjectionSourceAclBackfillPayload[] =
    shards === 1
      ? [payload]
      : Array.from({ length: shards }, (_, index) => ({
          ...payload,
          shard: { index, count: shards },
        }))
  const runIds: string[] = []
  for (const shardPayload of payloads) {
    const handle = await tasks.trigger(PROJECTION_SOURCE_ACL_BACKFILL_TASK_ID, shardPayload, {
      region,
    })
    runIds.push(handle.id)
  }
  logger.info('Projection source and ACL backfill enqueued', { runIds, shards })
  return { runIds }
}
