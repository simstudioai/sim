import { db } from '@sim/db'
import { dataDrainRuns, dataDrains } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { getJobQueue } from '@/lib/core/async-jobs'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('DataDrainsDispatcher')

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * Cron fires hourly. Without a buffer, a drain that finishes a few minutes
 * after the tick (lastRunAt = 10:05) won't satisfy `lastRunAt < now - cadence`
 * at the next tick (10:05 < 10:00 is false), so an "hourly" drain effectively
 * runs every two hours. Subtracting a small buffer from the cadence absorbs
 * normal run duration plus cron jitter without allowing back-to-back runs
 * within the same tick.
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
 * — but the drain `cursor` never advanced, so re-running is safe.
 */
export async function reapOrphanedRuns(now: Date = new Date()): Promise<{ reaped: number }> {
  const cutoff = new Date(now.getTime() - ORPHAN_THRESHOLD_MS)
  const reaped = await db
    .update(dataDrainRuns)
    .set({
      status: 'failed',
      finishedAt: now,
      error: `Orphaned run reaped after exceeding ${ORPHAN_THRESHOLD_MS / 60_000}m without completion`,
    })
    .where(and(eq(dataDrainRuns.status, 'running'), lt(dataDrainRuns.startedAt, cutoff)))
    .returning({ id: dataDrainRuns.id })
  if (reaped.length > 0) {
    logger.warn('Reaped orphaned data drain runs', { count: reaped.length })
  }
  return { reaped: reaped.length }
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

  const candidates = await db
    .select({
      id: dataDrains.id,
      organizationId: dataDrains.organizationId,
      lastRunAt: dataDrains.lastRunAt,
    })
    .from(dataDrains)
    .where(duePredicate)

  if (candidates.length === 0) {
    return { candidates: 0, dispatched: 0, skipped: 0, reaped }
  }

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

  const queue = await getJobQueue()
  let dispatched = 0
  let skipped = 0

  for (const candidate of candidates) {
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
      // concurrencyKey serializes runs of the same drain on the job queue, so
      // a manual run-now racing a cron claim can never execute in parallel.
      await queue.enqueue(
        'run-data-drain',
        { drainId: candidate.id, trigger: 'cron' },
        { concurrencyKey: `data-drain:${candidate.id}` }
      )
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

  logger.info('Data drain dispatch complete', {
    candidates: candidates.length,
    dispatched,
    skipped,
    reaped,
  })

  return { candidates: candidates.length, dispatched, skipped, reaped }
}
