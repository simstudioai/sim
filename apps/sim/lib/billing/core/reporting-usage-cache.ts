import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { randomInt } from '@sim/utils/random'
import type Redis from 'ioredis'
import { LRUCache } from 'lru-cache'
import { USAGE_LEDGER_STATEMENT_TIMEOUT_MS } from '@/lib/billing/constants'
import {
  type BillingEntity,
  getBillingPeriodUsageCost,
  type UsageQueryPeriod,
} from '@/lib/billing/core/usage-log'
import { getRedisClient } from '@/lib/core/config/redis'
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

/**
 * How long a read waits on a connected Redis before summing the ledger instead, so a socket that
 * has silently stopped answering costs one sum rather than the shared client's long timeouts.
 */
const SHARED_READ_TIMEOUT_MS = 250

/** Bump when a stored sum's meaning changes; old entries are then ignored. */
const SHARED_KEY_VERSION = 'v1'

/** A usage window known to be an enterprise reporting window — the only kind this cache serves. */
type ReportingQueryPeriod = UsageQueryPeriod & { source: 'reporting' }

function sharedReportingUsageKey(key: string): string {
  return `usage:reporting:${SHARED_KEY_VERSION}:${key}`
}

/**
 * How far behind the clock a prefix's cutoff sits. A row's `created_at` is its transaction's
 * start on the database clock, so a row stamped just before the cutoff can still be uncommitted
 * when the prefix is read; this lag puts every such row in the tail, which is summed on every
 * refill, rather than in a prefix that would miss it until its next refresh. It also absorbs
 * skew between this process's clock and the database's.
 */
const PREFIX_CUTOFF_LAG_MS = 5 * 60_000

/**
 * A prefix whose cutoff is this old is summed again by one process, about ten minutes after it
 * was read. Until then a refill sums only the rows since the cutoff, so the payer's year-long
 * scan runs once per refresh instead of once per {@link REPORTING_USAGE_CACHE_TTL_MS}.
 *
 * The prefix freezes the rows before its cutoff, and the ledger only grows (see
 * {@link REPORTING_USAGE_CACHE_TTL_MS}), so prefix plus tail never exceeds the true sum. What it
 * omits until the next refresh is a top-up to a row older than the cutoff — a long-running
 * cumulative charge — and a row whose transaction outlived {@link PREFIX_CUTOFF_LAG_MS}. The one
 * write that lowers the ledger is a user's deletion, whose rows cascade away; a prefix holding
 * them reads above the true sum until it is refreshed, by at most that member's usage.
 */
const PREFIX_REFRESH_AFTER_MS = 15 * 60_000

/**
 * How long after its cutoff a prefix stays in Redis. Between the refresh age and this, a prefix
 * is still served while another process holds the refresh lease, so a slow refresh never makes
 * every reader sum the whole window; past it, a reader whose refresh keeps failing sums exactly.
 */
const PREFIX_RETAIN_MS = 30 * 60_000

/**
 * The refresh lease is held for as long as one ledger sum may run, so a second process starts
 * the same sum only once the first has certainly ended, and a holder that died frees it then.
 */
const PREFIX_LEASE_MS = USAGE_LEDGER_STATEMENT_TIMEOUT_MS

/**
 * How long a reader with no prefix at all waits for the lease holder to store one before summing
 * the window itself, polling every {@link PREFIX_POLL_INTERVAL_MS}. It covers a typical sum, so
 * a payer's first reads after a deploy share one scan; a slower sum costs the waiting reader this
 * much latency and then exactly what it cost before the prefix existed.
 */
const PREFIX_WAIT_MS = 3_000
const PREFIX_POLL_INTERVAL_MS = 100

/**
 * The window's usage before `cutoff`, as one process summed it. Stored in Redis as
 * `<cutoff ms>:<cost>`, keyed like the full sum, so it only ever serves that payer's same window.
 */
interface LedgerPrefix {
  cutoff: number
  cost: number
}

function sharedPrefixKey(key: string): string {
  return `usage:reporting:${SHARED_KEY_VERSION}:prefix:${key}`
}

function sharedPrefixLeaseKey(key: string): string {
  return `usage:reporting:${SHARED_KEY_VERSION}:prefix-lease:${key}`
}

/**
 * The shared client, only while its connection is ready. A disconnected client parks commands in
 * its offline queue and replays them on reconnect, which would land a stale sum with a fresh
 * expiry, and `NX` would then keep newer sums out; so while it is not ready, no command is issued
 * at all and the ledger answers instead. Trigger.dev's `init` hook warms the connection, so it is
 * ready by the time a task reads.
 */
function readyRedisClient(): Redis | null {
  const redis = getRedisClient()
  return redis?.status === 'ready' ? redis : null
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
  const prefix = await readLedgerPrefix(key, entity, period)
  const cost = prefix
    ? prefix.cost +
      (await getBillingPeriodUsageCost(entity, { ...period, start: new Date(prefix.cutoff) }))
    : await getBillingPeriodUsageCost(entity, period)
  writeSharedReportingUsageCost(key, cost, sumStartedAt)
  return cost
}

/**
 * The stored prefix, `null` when none is stored or it does not fit this window, or `undefined`
 * when Redis did not answer in time or failed, which ends the prefix path for this read.
 */
async function readStoredPrefix(
  redis: Redis,
  key: string,
  period: ReportingQueryPeriod
): Promise<LedgerPrefix | null | undefined> {
  try {
    const stored = await withinDeadline(
      () => redis.get(sharedPrefixKey(key)),
      Date.now() + SHARED_READ_TIMEOUT_MS
    )
    if (stored === null) return null
    const [cutoffText = '', costText = ''] = stored.split(':')
    const cutoff = Number(cutoffText)
    const cost = parseStoredCost(costText)
    if (
      Number.isSafeInteger(cutoff) &&
      cutoff > period.start.getTime() &&
      cutoff < period.end.getTime() &&
      cost !== undefined
    ) {
      return { cutoff, cost }
    }
    logger.warn('Discarding unreadable shared reporting usage prefix', { key })
    return null
  } catch (error) {
    logger.warn('Shared reporting usage prefix read failed; summing the ledger', {
      error: getErrorMessage(error),
    })
    return undefined
  }
}

/**
 * Whether this process took the refresh lease. It is never released: the stored prefix ends the
 * need for it, and expiry frees it for the next refresh. A lease whose `SET` failed or timed out
 * may still have landed, held by nobody; it then blocks a refresh for {@link PREFIX_LEASE_MS},
 * during which readers serve the stored prefix or sum the window themselves. Not `acquireLock`,
 * which issues on a client that is not ready and has no read deadline.
 */
async function acquirePrefixLease(redis: Redis, key: string): Promise<boolean> {
  try {
    const result = await withinDeadline(
      () => redis.set(sharedPrefixLeaseKey(key), '1', 'PX', PREFIX_LEASE_MS, 'NX'),
      Date.now() + SHARED_READ_TIMEOUT_MS
    )
    return result === 'OK'
  } catch (error) {
    logger.warn('Shared reporting usage prefix lease failed', {
      error: getErrorMessage(error),
    })
    return false
  }
}

/**
 * Fire-and-forget, and only on a ready client, like {@link writeSharedReportingUsageCost}. A
 * plain `SET` replaces the stored prefix: every prefix is a lower bound for its own cutoff, so
 * two refreshes racing can leave either one, and the tail always resumes from the cutoff stored
 * with it.
 */
function writeStoredPrefix(key: string, prefix: LedgerPrefix): void {
  try {
    const redis = readyRedisClient()
    if (!redis) return
    redis
      .set(
        sharedPrefixKey(key),
        `${prefix.cutoff}:${prefix.cost}`,
        'PX',
        prefix.cutoff + PREFIX_RETAIN_MS - Date.now()
      )
      .catch(warnSharedWriteFailed)
  } catch (error) {
    warnSharedWriteFailed(error)
  }
}

async function waitForStoredPrefix(
  redis: Redis,
  key: string,
  period: ReportingQueryPeriod
): Promise<LedgerPrefix | undefined> {
  const deadline = Date.now() + PREFIX_WAIT_MS
  while (Date.now() < deadline) {
    await sleep(PREFIX_POLL_INTERVAL_MS)
    const stored = await readStoredPrefix(redis, key, period)
    if (stored === undefined) return undefined
    if (stored) return stored
  }
  return undefined
}

/**
 * The window's usage before a recent cutoff, shared across processes, or `undefined` to sum the
 * whole window as before: Redis is not ready or failing, the window does not span the cutoff, or
 * no prefix arrived in time. A fresh stored prefix is served as is. Otherwise one process takes
 * the lease and sums a new one, while the rest serve the stored prefix, or, with none stored,
 * wait for the holder's.
 */
async function readLedgerPrefix(
  key: string,
  entity: BillingEntity,
  period: ReportingQueryPeriod
): Promise<LedgerPrefix | undefined> {
  let redis: Redis | null
  try {
    redis = readyRedisClient()
  } catch {
    return undefined
  }
  if (!redis) return undefined
  const cutoff = Date.now() - PREFIX_CUTOFF_LAG_MS
  if (cutoff <= period.start.getTime() || cutoff >= period.end.getTime()) return undefined

  const stored = await readStoredPrefix(redis, key, period)
  if (stored === undefined) return undefined
  if (stored && Date.now() - stored.cutoff < PREFIX_REFRESH_AFTER_MS) return stored

  if (await acquirePrefixLease(redis, key)) {
    const cost = await getBillingPeriodUsageCost(entity, { ...period, end: new Date(cutoff) })
    const prefix = { cutoff, cost }
    writeStoredPrefix(key, prefix)
    return prefix
  }
  return stored ?? waitForStoredPrefix(redis, key, period)
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
 * {@link PREFIX_REFRESH_AFTER_MS} describe (including the one case that reads high: a deleted
 * member's usage, until the prefix refreshes), since their year-long sum is the expensive one; every other period is summed exactly, as
 * before. A read on a caller's own executor (a transaction or a replica) keeps its own snapshot
 * and is never shared.
 * Never use it for invoicing, cycle close, an edge-triggered decision, or a read that must see its
 * own write.
 */
export function readSoftGateUsageCost(
  entity: BillingEntity,
  period: UsageQueryPeriod,
  executor: DbClient = db
): Promise<number> {
  if (isReportingPeriod(period) && executor === db) {
    return readCachedReportingUsageCost(entity, period)
  }
  return getBillingPeriodUsageCost(entity, period, undefined, executor)
}
