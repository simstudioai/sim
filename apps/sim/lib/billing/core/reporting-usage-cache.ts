import { db, isPrimaryPoolClient } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { randomInt } from '@sim/utils/random'
import type Redis from 'ioredis'
import { LRUCache } from 'lru-cache'
import { USAGE_LEDGER_STATEMENT_TIMEOUT_MS } from '@/lib/billing/constants'
import {
  PREFIX_CUTOFF_LAG_MS,
  payerPrefixEpochKey,
  readyRedisClient,
  SHARED_KEY_VERSION,
  SHARED_PREFIX_EPOCH_KEY,
  SHARED_READ_TIMEOUT_MS,
} from '@/lib/billing/core/reporting-usage-epoch'
import {
  type BillingEntity,
  getBillingPeriodUsageCost,
  type UsageQueryPeriod,
} from '@/lib/billing/core/usage-log'
import { releaseLock } from '@/lib/core/config/redis'
import { withinDeadline } from '@/lib/core/utils/deadline'
import type { DbClient } from '@/lib/db/types'

const logger = createLogger('ReportingUsageCache')

/**
 * How long a reporting-window usage sum is served before it is summed again.
 *
 * A reporting window is an enterprise contract period, up to a year long, so its sum scans every
 * ledger row the payer wrote in that year, and the soft gates below re-ran it once per billable
 * event. The ledger only grows within a window (rows are inserted at a cost above zero, and the
 * one update is a monotonic top-up), so a served sum is never above the true one: it omits at
 * most the usage written since it was read. That is the safe direction for every reader here —
 * an admission gate lets a payer run on for at most this long past their limit, and a sum at or
 * above the limit is a refusal the true sum would also give. Thirty seconds keeps that overrun
 * small against a year-long allowance while turning a per-event scan into one per window.
 *
 * A sum is held both in Redis, shared by every process, and in each process that reads it. It
 * reflects the ledger as of the moment its sum began, and its Redis expiry is anchored to that
 * moment, so it is served from Redis for at most max(this TTL + jitter, the sum's duration +
 * {@link MIN_SHARED_TTL_MS}) after it began (plus any reconnect delay for a resent write), plus
 * up to this TTL again in the reading process.
 *
 * While Redis is ready, a sum is built from a shared {@link LedgerPrefix} plus the rows since its
 * cutoff, which adds the prefix's own lag on top of this one; see {@link PREFIX_REFRESH_AFTER_MS}.
 */
export const REPORTING_USAGE_CACHE_TTL_MS = 30_000

/** Redis expiry is jittered by up to this much, so payers summed together do not expire together. */
const SHARED_TTL_JITTER_MS = 5_000

/**
 * The shortest time a sum is kept in Redis. A sum that ran longer than the TTL would otherwise
 * expire on arrival, and under the database pressure that makes sums slow, every process would
 * then run the same slow sum again. Five seconds shares it with the processes waiting on it while
 * adding little staleness next to the time the sum itself took.
 */
const MIN_SHARED_TTL_MS = 5_000

/** A usage window known to be an enterprise reporting window — the only kind this cache serves. */
type ReportingQueryPeriod = UsageQueryPeriod & { source: 'reporting' }

function sharedReportingUsageKey(key: string): string {
  return `usage:reporting:${SHARED_KEY_VERSION}:${key}`
}

/**
 * How long after it was read a prefix is summed again, by one process. Until then a refill sums
 * only the rows since the cutoff, so a payer's year-long scan runs about once per this interval
 * instead of once per {@link REPORTING_USAGE_CACHE_TTL_MS} in every process that misses.
 *
 * The prefix freezes the rows before its cutoff, and the ledger only grows (see
 * {@link REPORTING_USAGE_CACHE_TTL_MS}), so prefix plus tail never exceeds the true sum. A
 * top-up to a row old enough to sit in a prefix — a long-running cumulative charge — discards
 * the payer's prefixes once it commits (`invalidatePayerPrefixesForTopUp`), so the next read
 * sums the window again and sees it as soon as it would have without the prefix. What a prefix
 * still omits until it is read again is a row whose transaction outlived
 * {@link PREFIX_CUTOFF_LAG_MS}, so this interval is the extra lag that rare write sees. Deleting
 * a user is the one write that lowers the ledger; it discards every prefix through
 * `invalidateReportingUsagePrefixes`.
 */
const PREFIX_REFRESH_AFTER_MS = 3 * 60_000

/**
 * The refresh lease is held for as long as one ledger sum may run, so a second process starts
 * the same sum only once the first has certainly ended, and a holder that died frees it then.
 * Nothing tells a stranded lease from a live one, and nothing needs to: while it is held, every
 * other reader serves the stored prefix or, with none, sums the whole window. Its holder
 * releases it once the new prefix is stored, so a prefix discarded by an epoch bump right after
 * is refreshed by the next read rather than leaving every reader summing the whole window.
 */
const PREFIX_LEASE_MS = USAGE_LEDGER_STATEMENT_TIMEOUT_MS

/**
 * How long after it was read a prefix stays in Redis, served while another process holds the
 * refresh lease: the refresh interval plus one full lease. This is the most a prefix can lag
 * when a refresh fails; past it a reader sums the window exactly.
 */
const PREFIX_RETAIN_MS = PREFIX_REFRESH_AFTER_MS + PREFIX_LEASE_MS

/** The global and payer prefix epochs current when a prefix was summed; `''` while unset. */
interface PrefixEpochs {
  epoch: string
  payerEpoch: string
}

/**
 * The window's usage before `cutoff`, as one process summed it under the epochs it read first.
 * Stored in Redis as `<epoch>:<payer epoch>:<cutoff ms>:<cost>`, keyed like the full sum, so it
 * only ever serves that payer's same window, and only while both epochs are still current.
 */
interface LedgerPrefix extends PrefixEpochs {
  cutoff: number
  cost: number
}

function sharedPrefixKey(key: string): string {
  return `usage:reporting:${SHARED_KEY_VERSION}:prefix:${key}`
}

function sharedPrefixLeaseKey(key: string): string {
  return `usage:reporting:${SHARED_KEY_VERSION}:prefix-lease:${key}`
}

/** A stored cost, or `undefined` unless it is a non-negative number. */
function parseStoredCost(text: string): number | undefined {
  const cost = Number(text)
  return text.trim() !== '' && Number.isFinite(cost) && cost >= 0 ? cost : undefined
}

/**
 * A sum another process stored, or `undefined` when there is none to use. Redis being absent,
 * not ready, slow, or failing, and a value that is not a non-negative number, are all misses:
 * the caller sums the ledger, so the cache can cost a read its latency but never its answer.
 */
async function readSharedReportingUsageCost(key: string): Promise<number | undefined> {
  try {
    const redis = readyRedisClient()
    if (!redis) return undefined
    const stored = await withinDeadline(
      () => redis.get(sharedReportingUsageKey(key)),
      Date.now() + SHARED_READ_TIMEOUT_MS
    )
    if (stored === null) return undefined
    const cost = parseStoredCost(stored)
    if (cost !== undefined) return cost
    logger.warn('Discarding unreadable shared reporting usage', { key })
  } catch (error) {
    logger.warn('Shared reporting usage read failed; summing the ledger', {
      error: getErrorMessage(error),
    })
  }
  return undefined
}

function warnSharedWriteFailed(error: unknown): void {
  logger.warn('Shared reporting usage write failed', { error: getErrorMessage(error) })
}

/**
 * Fire-and-forget: a read never waits on, or fails because of, the shared write. The expiry is
 * anchored to when the sum began: the remaining lifetime is computed here and written with `PX`,
 * which every Redis version accepts, floored at {@link MIN_SHARED_TTL_MS}. A write the client
 * resends after a reconnect re-applies that same relative lifetime from the resend, so it can
 * extend the expiry by at most the reconnect delay. The write only lands when no sum is stored
 * (`NX`), so an older sum can never replace a fresher one or extend its expiry.
 */
function writeSharedReportingUsageCost(key: string, cost: number, sumStartedAt: number): void {
  try {
    const redis = readyRedisClient()
    if (!redis) return
    const remainingMs =
      sumStartedAt + REPORTING_USAGE_CACHE_TTL_MS + randomInt(0, SHARED_TTL_JITTER_MS) - Date.now()
    redis
      .set(
        sharedReportingUsageKey(key),
        String(cost),
        'PX',
        Math.max(remainingMs, MIN_SHARED_TTL_MS),
        'NX'
      )
      .catch(warnSharedWriteFailed)
  } catch (error) {
    warnSharedWriteFailed(error)
  }
}

/**
 * The sum from Redis when another process stored one, else the ledger's exact sum, stored for
 * the others. Trigger.dev runs each task in a fresh process, so the in-process cache alone is
 * always cold there; the shared value is what spares those runs the scan.
 */
async function sumReportingUsageCost(
  key: string,
  entity: BillingEntity,
  period: ReportingQueryPeriod
): Promise<number> {
  const shared = await readSharedReportingUsageCost(key)
  if (shared !== undefined) return shared
  const sumStartedAt = Date.now()
  const prefix = await resolveLedgerPrefix(key, entity, period)
  const [prefixCost, tailCost] = await Promise.all([
    prefix?.cost ?? 0,
    getBillingPeriodUsageCost(
      entity,
      prefix ? { ...period, start: new Date(prefix.cutoff) } : period
    ),
  ])
  const cost = prefixCost + tailCost
  writeSharedReportingUsageCost(key, cost, sumStartedAt)
  return cost
}

interface StoredPrefixState {
  /** The epochs current now, which a prefix summed by this read is stored under. */
  epochs: PrefixEpochs
  /** The stored prefix, when there is one for this window under both current epochs. */
  prefix: LedgerPrefix | null
}

/**
 * The stored prefix and the current epochs in one round trip, or `undefined` when Redis did not
 * answer in time or failed, which ends the prefix path for this read. A prefix summed under an
 * earlier global or payer epoch, or that does not fit this window, is no prefix.
 */
async function readStoredPrefix(
  redis: Redis,
  key: string,
  entity: BillingEntity,
  period: ReportingQueryPeriod
): Promise<StoredPrefixState | undefined> {
  try {
    const [stored, epoch, payerEpoch] = await withinDeadline(
      () => redis.mget(sharedPrefixKey(key), SHARED_PREFIX_EPOCH_KEY, payerPrefixEpochKey(entity)),
      Date.now() + SHARED_READ_TIMEOUT_MS
    )
    const epochs: PrefixEpochs = { epoch: epoch ?? '', payerEpoch: payerEpoch ?? '' }
    if (!stored) return { epochs, prefix: null }
    const [storedEpoch, storedPayerEpoch, cutoffText = '', costText = '', ...rest] =
      stored.split(':')
    const cutoff = Number(cutoffText)
    const cost = parseStoredCost(costText)
    if (
      rest.length === 0 &&
      Number.isSafeInteger(cutoff) &&
      cutoff > period.start.getTime() &&
      cutoff < period.end.getTime() &&
      cost !== undefined
    ) {
      const current = storedEpoch === epochs.epoch && storedPayerEpoch === epochs.payerEpoch
      return { epochs, prefix: current ? { ...epochs, cutoff, cost } : null }
    }
    logger.warn('Discarding unreadable shared reporting usage prefix', { key })
    return { epochs, prefix: null }
  } catch (error) {
    logger.warn('Shared reporting usage prefix read failed; summing the ledger', {
      error: getErrorMessage(error),
    })
    return undefined
  }
}

/**
 * This process's token for the refresh lease, or `null` when it did not take it. A refresh that
 * fails keeps the lease until expiry, as a backoff. A lease whose `SET` failed or timed out may
 * still have landed, held by nobody, for {@link PREFIX_LEASE_MS}. Not `acquireLock`, which
 * issues on a client that is not ready and has no read deadline.
 */
async function acquirePrefixLease(redis: Redis, key: string): Promise<string | null> {
  const token = generateShortId()
  try {
    const result = await withinDeadline(
      () => redis.set(sharedPrefixLeaseKey(key), token, 'PX', PREFIX_LEASE_MS, 'NX'),
      Date.now() + SHARED_READ_TIMEOUT_MS
    )
    return result === 'OK' ? token : null
  } catch (error) {
    logger.warn('Shared reporting usage prefix lease failed', {
      error: getErrorMessage(error),
    })
    return null
  }
}

/**
 * Fire-and-forget, and only on a ready client, like {@link writeSharedReportingUsageCost}. A
 * plain `SET` replaces the stored prefix: every prefix is a lower bound for its own cutoff, so
 * two refreshes racing can leave either one, and the tail always resumes from the cutoff stored
 * with it. Once it lands, the lease is released only while it still holds `lease`, so one that
 * expired and was taken by another process is left to that process.
 */
function writeStoredPrefix(key: string, prefix: LedgerPrefix, lease: string): void {
  try {
    const redis = readyRedisClient()
    if (!redis) return
    redis
      .set(
        sharedPrefixKey(key),
        `${prefix.epoch}:${prefix.payerEpoch}:${prefix.cutoff}:${prefix.cost}`,
        'PX',
        prefix.cutoff + PREFIX_CUTOFF_LAG_MS + PREFIX_RETAIN_MS - Date.now()
      )
      .then(() => releaseLock(sharedPrefixLeaseKey(key), lease))
      .catch(warnSharedWriteFailed)
  } catch (error) {
    warnSharedWriteFailed(error)
  }
}

/** A prefix to add the tail to; `cost` is still pending while this read sums it. */
interface ResolvedPrefix {
  cutoff: number
  cost: number | Promise<number>
}

/**
 * The window's usage before a recent cutoff, shared across processes, or `undefined` to sum the
 * whole window: Redis is not ready or failing, the window does not span the cutoff, or no
 * prefix is stored and another process holds the lease. A fresh stored prefix is served as is.
 * Otherwise the process that takes the lease sums a new prefix alongside its tail, and the rest
 * serve the stored one while it does.
 */
async function resolveLedgerPrefix(
  key: string,
  entity: BillingEntity,
  period: ReportingQueryPeriod
): Promise<ResolvedPrefix | undefined> {
  let redis: Redis | null
  try {
    redis = readyRedisClient()
  } catch {
    return undefined
  }
  if (!redis) return undefined
  const cutoff = Date.now() - PREFIX_CUTOFF_LAG_MS
  if (cutoff <= period.start.getTime() || cutoff >= period.end.getTime()) return undefined

  const state = await readStoredPrefix(redis, key, entity, period)
  if (!state) return undefined
  const { epochs, prefix: stored } = state
  if (stored && cutoff - stored.cutoff < PREFIX_REFRESH_AFTER_MS) return stored

  const lease = await acquirePrefixLease(redis, key)
  if (lease) {
    const cost = getBillingPeriodUsageCost(entity, { ...period, end: new Date(cutoff) }).then(
      (prefixCost) => {
        writeStoredPrefix(key, { ...epochs, cutoff, cost: prefixCost }, lease)
        return prefixCost
      }
    )
    return { cutoff, cost }
  }
  return stored ?? undefined
}

/**
 * Sums held by this process, one per payer and window, in front of the shared Redis value. Every
 * key is an enterprise payer's current window, a few dozen bytes each, so the ceiling sits far
 * above any process's working set and only backstops memory; an eviction inside the TTL costs
 * one extra read.
 *
 * `fetchMethod` coalesces concurrent misses onto one read. A rejected sum is evicted rather than
 * stored (`noDeleteOnFetchRejection` and `allowStaleOnFetchRejection` stay off), so every caller
 * of that read sees the error it would have seen uncached and the next call sums again. There is
 * no settle deadline: the sum runs under the ledger's own `statement_timeout`, so the database
 * ends a slow one. There is deliberately no invalidator either — usage is written by execution
 * workers in other processes, so the TTL is the real bound. Concurrent misses in different
 * processes each sum the short tail; only the prefix refresh is leased to one of them.
 */
const reportingUsageCache = new LRUCache<
  string,
  number,
  { entity: BillingEntity; period: ReportingQueryPeriod }
>({
  max: 1_000,
  ttl: REPORTING_USAGE_CACHE_TTL_MS,
  fetchMethod: (key, _stale, { context }) =>
    sumReportingUsageCost(key, context.entity, context.period),
})

/**
 * The key names the period's source as well as its bounds, so a sum can only ever be shared
 * with a read of the same kind of window, even if another source someday reaches this cache.
 */
function reportingUsageKey(entity: BillingEntity, period: ReportingQueryPeriod): string {
  return `${entity.type}:${entity.id}:${period.source}:${period.start.toISOString()}:${period.end.toISOString()}`
}

function isReportingPeriod(period: UsageQueryPeriod): period is ReportingQueryPeriod {
  return period.source === 'reporting'
}

async function readCachedReportingUsageCost(
  entity: BillingEntity,
  period: ReportingQueryPeriod
): Promise<number> {
  const cost = await reportingUsageCache.fetch(reportingUsageKey(entity, period), {
    context: { entity, period },
  })
  return cost !== undefined ? cost : getBillingPeriodUsageCost(entity, period)
}

/**
 * Period usage for a soft reader: an admission check, a display, or a level-triggered
 * notification that tolerates the cache's bounded under-count. Enterprise reporting windows are
 * served from the shared cache, within the lag {@link REPORTING_USAGE_CACHE_TTL_MS} and
 * {@link PREFIX_REFRESH_AFTER_MS} describe, since their year-long sum is the expensive one; every
 * other period is summed exactly. A read on a caller's own executor (a transaction or a replica)
 * keeps its own snapshot and is never shared.
 * Never use it for invoicing, cycle close, an edge-triggered decision, or a read that must see its
 * own write.
 */
export function readSoftGateUsageCost(
  entity: BillingEntity,
  period: UsageQueryPeriod,
  executor: DbClient = db
): Promise<number> {
  if (isReportingPeriod(period) && isPrimaryPoolClient(executor)) {
    return readCachedReportingUsageCost(entity, period)
  }
  return getBillingPeriodUsageCost(entity, period, undefined, executor)
}
