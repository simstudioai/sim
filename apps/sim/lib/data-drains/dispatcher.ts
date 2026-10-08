import { db } from '@sim/db'
import { dataDrainRuns, dataDrains } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, asc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { enqueueDrain } from '@/lib/data-drains/enqueue'

const logger = createLogger('DataDrainsDispatcher')

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const DISPATCH_PAGE_SIZE = 200

/**
 * Cron start times drift. A small buffer lets the next hourly tick claim a
 * drain whose preceding tick started late. Cadence is measured from the
 * worker's claim timestamp, independently of delivery duration.
 */
const CADENCE_BUFFER_MS = 5 * 60 * 1000

/**
 * Maximum wall-clock duration any single drain run is allowed before its
 * `data_drain_runs` row is considered orphaned. Runs that exceed this are
 * almost certainly the result of a Trigger.dev worker crash mid-run — there
 * is no live process still updating them.
 */
const ORPHAN_THRESHOLD_MS = 60 * 60 * 1000

/**
 * Marks `running` rows older than the orphan threshold as `failed`. Without
 * this, a worker crash leaves run history permanently misleading and (worse)
 * the drain row's `lastRunAt` reflects a successful claim that never finished
 * — the next run resumes after the last acknowledged checkpoint.
 */
export async function reapOrphanedRuns(now: Date = new Date()): Promise<{ reaped: number }> {
  const cutoff = new Date(now.getTime() - ORPHAN_THRESHOLD_MS)
  const result = await db.execute<{ count: number }>(sql`
    WITH reaped AS (
      UPDATE ${dataDrainRuns}
      SET status = 'failed',
          finished_at = ${sql.param(now, dataDrainRuns.finishedAt)},
          error = ${`Orphaned run reaped after exceeding ${ORPHAN_THRESHOLD_MS / 60_000}m without completion`}
      WHERE ${dataDrainRuns.status} = 'running'
        AND ${dataDrainRuns.startedAt} < ${sql.param(cutoff, dataDrainRuns.startedAt)}
      RETURNING 1
    )
    SELECT count(*)::integer AS count FROM reaped
  `)
  const reaped = result[0]?.count ?? 0
  if (reaped > 0) {
    logger.warn('Reaped orphaned data drain runs', { count: reaped })
  }
  return { reaped }
}

/**
 * Selects every enabled drain whose schedule is due (or has never run) and
 * fans out one `run-data-drain` job per drain. Each drain is atomically
 * claimed via a conditional UPDATE before being enqueued — two concurrent
 * dispatcher invocations cannot both win the same row, and a manual run that
 * lands between the SELECT and the UPDATE will lose the race cleanly. Drains
 * belonging to orgs that have lapsed off the enterprise plan are skipped.
 */
export async function dispatchDueDrains(now: Date = new Date()): Promise<{
  candidates: number
  dispatched: number
  skipped: number
  reaped: number
}> {
  const { reaped } = await reapOrphanedRuns(now)

  const hourlyCutoff = new Date(now.getTime() - HOUR_MS + CADENCE_BUFFER_MS)
  const dailyCutoff = new Date(now.getTime() - DAY_MS + CADENCE_BUFFER_MS)

  const duePredicate = and(
    eq(dataDrains.enabled, true),
    or(
      isNull(dataDrains.lastRunAt),
      and(eq(dataDrains.scheduleCadence, 'hourly'), lt(dataDrains.lastRunAt, hourlyCutoff)),
      and(eq(dataDrains.scheduleCadence, 'daily'), lt(dataDrains.lastRunAt, dailyCutoff))
    )
  )

  // Self-hosted deployments have no subscription infra; `DATA_DRAINS_ENABLED`
  // is the global on/off there. Cache per-org so a multi-drain org pays one
  // billing lookup.
  const enterpriseCache = new Map<string, boolean>()
  const isEnterprise = async (orgId: string): Promise<boolean> => {
    if (!isBillingEnabled) return true
    const cached = enterpriseCache.get(orgId)
    if (cached !== undefined) return cached
    const result = await isOrganizationOnEnterprisePlan(orgId)
    enterpriseCache.set(orgId, result)
    return result
  }

  let dispatched = 0
  let skipped = 0
  let candidates = 0
  let afterId: string | undefined

  while (true) {
    const page = await db
      .select({
        id: dataDrains.id,
        organizationId: dataDrains.organizationId,
        lastRunAt: dataDrains.lastRunAt,
      })
      .from(dataDrains)
      .where(and(duePredicate, afterId ? gt(dataDrains.id, afterId) : undefined))
      .orderBy(asc(dataDrains.id))
      .limit(DISPATCH_PAGE_SIZE)
    if (page.length === 0) break
    candidates += page.length
    enterpriseCache.clear()

    for (const candidate of page) {
      let enterprise: boolean
      try {
        enterprise = await isEnterprise(candidate.organizationId)
      } catch (error) {
        // A billing-API failure for one org must not abort the whole batch —
        // skip this drain and let the next cron tick retry it.
        logger.warn('Enterprise check failed; skipping drain', {
          drainId: candidate.id,
          organizationId: candidate.organizationId,
          error,
        })
        skipped++
        continue
      }
      if (!enterprise) {
        skipped++
        continue
      }

      // Conditional claim — re-asserts the due predicate to lose to any other
      // dispatcher or manual-run path that's already moved this drain forward.
      const claimed = await db
        .update(dataDrains)
        .set({ lastRunAt: now, updatedAt: now })
        .where(and(eq(dataDrains.id, candidate.id), duePredicate))
        .returning({ id: dataDrains.id })

      if (claimed.length === 0) continue

      try {
        // Queue limits bound execution; the database claim also fences workers
        // across app processes and concurrent manual requests.
        await enqueueDrain(candidate.id, 'cron')
        dispatched++
      } catch (error) {
        // Roll back the claim so a transient queue outage doesn't delay this
        // drain by a full cadence. Scoped to our own claim timestamp so it
        // can't trample a concurrent advance. The rollback itself is guarded
        // so a DB error here doesn't abort the rest of the batch.
        try {
          await db
            .update(dataDrains)
            .set({ lastRunAt: candidate.lastRunAt, updatedAt: now })
            .where(and(eq(dataDrains.id, candidate.id), eq(dataDrains.lastRunAt, now)))
        } catch (rollbackError) {
          logger.error('Failed to roll back data-drain claim after enqueue failure', {
            drainId: candidate.id,
            enqueueError: toError(error).message,
            rollbackError: toError(rollbackError).message,
          })
          continue
        }
        logger.error('Failed to enqueue data-drain job; rolled back claim', {
          drainId: candidate.id,
          error,
        })
      }
    }
    afterId = page[page.length - 1].id
    if (page.length < DISPATCH_PAGE_SIZE) break
  }

  logger.info('Data drain dispatch complete', {
    candidates,
    dispatched,
    skipped,
    reaped,
  })

  return { candidates, dispatched, skipped, reaped }
}
