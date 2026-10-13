import { db } from '@sim/db'
import { rateLimitBucket } from '@sim/db/schema'
import { eq, type SQL, sql } from 'drizzle-orm'
import type {
  AtomicAdmissionOptions,
  AtomicAdmissionResult,
  ConsumeResult,
  RateLimitStorageAdapter,
  TokenBucketConfig,
  TokenBucketReservation,
  TokenStatus,
} from '@/lib/core/rate-limiter/storage/adapter'

/** Thrown inside the admission transaction to roll back a spend that finished past its deadline. */
class AdmissionExpiredError extends Error {}

interface AdmissionRow extends Record<string, unknown> {
  kind: 'reservation' | 'cooldown'
  cost: number | null
  available: number | null
  last_refill_ms: number | null
  refill_rate: number | null
  refill_interval_ms: number | null
  blocked_until_ms: number | null
  allowed: boolean
  spent: number
  now_ms: number
}

/** An array of scalar binds; the pool cannot bind a JavaScript array as one parameter. */
function sqlArray(values: readonly (string | number)[], type: 'text' | 'float8'): SQL {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )}]::${sql.raw(type)}[]`
}

/**
 * Locks every key in sorted order, refills each reservation to the moment every lock is held
 * with the same float8 arithmetic {@link DbTokenBucket.consumeTokens} uses in JavaScript, and
 * spends all reservations only when no cooldown is active and every balance covers its cost.
 * Returns one row per reservation and per cooldown key, each carrying the decision, how many
 * buckets were spent, and the clock the decision used.
 *
 * That clock is the caller's `sentAt` advanced by the time spent acquiring the locks, in whole
 * milliseconds. `lock_start` is joined into `locked`, so it is read before the first row can
 * reach the lock; `clock` counts every `locked` row before reading `clock_timestamp()` again, so
 * that read happens only once the last lock is held. An uncontended admission therefore decides
 * at exactly `sentAt`, and measuring the wait rather than reading the database's absolute time
 * keeps every stored instant on the application clock that wrote it.
 */
function buildAdmissionStatement(
  reservations: readonly TokenBucketReservation[],
  cooldownKeys: readonly string[],
  keys: readonly string[],
  sentAt: number
): SQL {
  return sql`
    WITH reservation AS (
      SELECT * FROM unnest(
        ${sqlArray(
          reservations.map((item) => item.key),
          'text'
        )},
        ${sqlArray(
          reservations.map((item) => item.cost),
          'float8'
        )},
        ${sqlArray(
          reservations.map((item) => item.config.maxTokens),
          'float8'
        )},
        ${sqlArray(
          reservations.map((item) => item.config.refillRate),
          'float8'
        )},
        ${sqlArray(
          reservations.map((item) => item.config.refillIntervalMs),
          'float8'
        )}
      ) AS r(key, cost, max_tokens, refill_rate, refill_interval_ms)
    ),
    lock_start AS (
      SELECT clock_timestamp() AS started_at
    ),
    locked AS (
      SELECT bucket.key, bucket.tokens, bucket.last_refill_at, bucket.blocked_until
      FROM ${rateLimitBucket} AS bucket
      CROSS JOIN lock_start
      WHERE bucket.key = ANY(${sqlArray(keys, 'text')})
      ORDER BY bucket.key
      FOR UPDATE OF bucket
    ),
    clock AS (
      SELECT ${sentAt}::float8
        + GREATEST(0, floor(extract(epoch FROM (held.locked_at - lock_start.started_at)) * 1000))
        AS now_ms
      FROM (SELECT clock_timestamp() AS locked_at FROM (SELECT count(*) FROM locked) every_lock) held
      CROSS JOIN lock_start
    ),
    balance AS (
      SELECT
        r.key,
        r.cost,
        r.refill_rate,
        r.refill_interval_ms,
        LEAST(r.max_tokens, GREATEST(0, l.tokens::float8) + e.elapsed * r.refill_rate) AS available,
        m.last_ms + e.elapsed * r.refill_interval_ms AS last_refill_ms,
        l.last_refill_at + (e.elapsed * r.refill_interval_ms) * interval '1 millisecond' AS last_refill_at
      FROM reservation r
      JOIN locked l ON l.key = r.key
      CROSS JOIN clock
      CROSS JOIN LATERAL (
        SELECT (extract(epoch FROM l.last_refill_at) * 1000)::float8 AS last_ms
      ) m
      CROSS JOIN LATERAL (
        SELECT GREATEST(0, floor((clock.now_ms - m.last_ms) / r.refill_interval_ms)) AS elapsed
      ) e
    ),
    cooldown AS (
      SELECT (extract(epoch FROM blocked_until) * 1000)::float8 AS blocked_until_ms
      FROM locked
      WHERE key = ANY(${sqlArray(cooldownKeys, 'text')})
    ),
    decision AS (
      SELECT
        NOT EXISTS (SELECT 1 FROM balance WHERE available < cost)
        AND NOT EXISTS (
          SELECT 1 FROM cooldown, clock WHERE cooldown.blocked_until_ms > clock.now_ms
        ) AS allowed
    ),
    spent AS (
      UPDATE ${rateLimitBucket} AS bucket
      SET
        tokens = (balance.available - balance.cost)::text::numeric,
        last_refill_at = balance.last_refill_at,
        updated_at = timestamp '1970-01-01' + clock.now_ms * interval '1 millisecond'
      FROM balance, decision, clock
      WHERE decision.allowed AND bucket.key = balance.key
      RETURNING bucket.key
    ),
    outcome AS (
      SELECT decision.allowed, (SELECT count(*) FROM spent)::int AS spent, clock.now_ms
      FROM decision, clock
    )
    SELECT 'reservation' AS kind, b.cost, b.available, b.last_refill_ms, b.refill_rate,
      b.refill_interval_ms, NULL::float8 AS blocked_until_ms, o.allowed, o.spent, o.now_ms
    FROM balance b CROSS JOIN outcome o
    UNION ALL
    SELECT 'cooldown', NULL, NULL, NULL, NULL, NULL, c.blocked_until_ms, o.allowed, o.spent,
      o.now_ms
    FROM cooldown c CROSS JOIN outcome o
  `
}

/**
 * Derives the wait from the locked balances and cross-checks it against the statement's own
 * decision, so the JavaScript reading and the SQL spend can never disagree silently: a mismatch,
 * or a reservation whose bucket vanished, throws and rolls the spend back.
 */
function readAdmissionResult(
  rows: readonly AdmissionRow[],
  reservations: readonly TokenBucketReservation[],
  now: number
): AtomicAdmissionResult {
  let retryAfterMs = 0
  let reserved = 0
  for (const row of rows) {
    if (row.kind === 'cooldown') {
      if (row.blocked_until_ms !== null) {
        retryAfterMs = Math.max(retryAfterMs, Number(row.blocked_until_ms) - now)
      }
      continue
    }
    reserved++
    const available = Number(row.available)
    const cost = Number(row.cost)
    if (available < cost) {
      retryAfterMs = Math.max(
        retryAfterMs,
        Number(row.last_refill_ms) +
          Math.ceil((cost - available) / Number(row.refill_rate)) * Number(row.refill_interval_ms) -
          now
      )
    }
  }
  if (reserved !== reservations.length) {
    throw new Error('Rate limit bucket disappeared during admission')
  }
  const allowed = rows[0]?.allowed ?? true
  const spent = rows[0]?.spent ?? 0
  const spentExpected = allowed ? new Set(reservations.map((item) => item.key)).size : 0
  if (allowed !== retryAfterMs <= 0 || spent !== spentExpected) {
    throw new Error('Rate limit admission decision is inconsistent')
  }
  return allowed ? { allowed: true, retryAfterMs: 0 } : { allowed: false, retryAfterMs }
}

export class DbTokenBucket implements RateLimitStorageAdapter {
  async consumeTokens(
    key: string,
    requestedTokens: number,
    config: TokenBucketConfig
  ): Promise<ConsumeResult> {
    return db.transaction(async (tx) => {
      const createdAt = new Date()
      await tx
        .insert(rateLimitBucket)
        .values({
          key,
          tokens: String(config.maxTokens),
          lastRefillAt: createdAt,
          updatedAt: createdAt,
        })
        .onConflictDoNothing()

      const [record] = await tx
        .select({ tokens: rateLimitBucket.tokens, lastRefillAt: rateLimitBucket.lastRefillAt })
        .from(rateLimitBucket)
        .where(eq(rateLimitBucket.key, key))
        .for('update')
        .limit(1)
      if (!record) throw new Error('Rate limit bucket disappeared during admission')

      const now = new Date()
      const intervalsElapsed = Math.max(
        0,
        Math.floor((now.getTime() - record.lastRefillAt.getTime()) / config.refillIntervalMs)
      )
      /** Old denied writes used -1; normalize them without granting a new burst. */
      const available = Math.min(
        config.maxTokens,
        Math.max(0, Number(record.tokens)) + intervalsElapsed * config.refillRate
      )
      const allowed = available >= requestedTokens
      const tokensRemaining = allowed ? available - requestedTokens : available
      const lastRefillAt = new Date(
        record.lastRefillAt.getTime() + intervalsElapsed * config.refillIntervalMs
      )
      await tx
        .update(rateLimitBucket)
        .set({ tokens: String(tokensRemaining), lastRefillAt, updatedAt: now })
        .where(eq(rateLimitBucket.key, key))

      const intervalsUntilAdmission = Math.max(
        1,
        Math.ceil((requestedTokens - tokensRemaining) / config.refillRate)
      )
      const resetAt = new Date(lastRefillAt.getTime() + config.refillIntervalMs)
      return {
        allowed,
        tokensRemaining,
        resetAt,
        retryAfterMs: allowed
          ? undefined
          : Math.max(
              0,
              lastRefillAt.getTime() +
                intervalsUntilAdmission * config.refillIntervalMs -
                now.getTime()
            ),
      }
    })
  }

  /**
   * Locks all dimensions and provider gates before spending any capacity.
   *
   * The lock, refill, decision, and spend run as one statement, so the bucket rows stay locked
   * for that statement and the commit rather than for a round trip per dimension: every waiter
   * on a hot provider key queues behind that whole hold. Refill and cooldowns are judged at the
   * moment the locks are held, as before, so a wait for a contended lock is refilled.
   */
  async consumeTokensAtomically(
    reservations: readonly TokenBucketReservation[],
    options: AtomicAdmissionOptions
  ): Promise<AtomicAdmissionResult> {
    options.signal?.throwIfAborted()
    if (Date.now() >= options.deadlineAt) return { allowed: false, retryAfterMs: 0 }
    const keys = [
      ...new Set([...options.cooldownKeys, ...reservations.map((item) => item.key)]),
    ].sort()
    if (keys.length === 0) return { allowed: true, retryAfterMs: 0 }
    try {
      return await db.transaction(async (tx) => {
        const remainingMs = Math.max(1, options.deadlineAt - Date.now())
        await tx.execute(
          sql`SELECT set_config('statement_timeout', ${String(remainingMs)}, true), set_config('lock_timeout', ${String(remainingMs)}, true)`
        )
        const createdAt = new Date()
        await tx
          .insert(rateLimitBucket)
          .values(
            keys.map((key) => {
              const reservation = reservations.find((item) => item.key === key)
              return {
                key,
                tokens: String(reservation?.config.maxTokens ?? 0),
                lastRefillAt: createdAt,
                updatedAt: createdAt,
              }
            })
          )
          .onConflictDoNothing()
        options.signal?.throwIfAborted()
        const sentAt = Date.now()
        const rows = await tx.execute<AdmissionRow>(
          buildAdmissionStatement(reservations, options.cooldownKeys, keys, sentAt)
        )
        const now = rows[0]?.now_ms ?? sentAt
        options.signal?.throwIfAborted()
        if (Math.max(now, Date.now()) >= options.deadlineAt) throw new AdmissionExpiredError()
        return readAdmissionResult(rows, reservations, now)
      })
    } catch (error) {
      if (error instanceof AdmissionExpiredError) return { allowed: false, retryAfterMs: 0 }
      throw error
    }
  }

  async getCooldownUntil(key: string): Promise<Date | null> {
    const [row] = await db
      .select({ until: rateLimitBucket.blockedUntil })
      .from(rateLimitBucket)
      .where(eq(rateLimitBucket.key, key))
      .limit(1)
    return row?.until ?? null
  }

  async setCooldownUntil(key: string, until: Date): Promise<void> {
    const now = new Date()
    await db
      .insert(rateLimitBucket)
      .values({ key, tokens: '0', lastRefillAt: now, updatedAt: now, blockedUntil: until })
      .onConflictDoUpdate({
        target: rateLimitBucket.key,
        set: {
          blockedUntil: sql`GREATEST(${rateLimitBucket.blockedUntil}, excluded.blocked_until)`,
          updatedAt: now,
        },
      })
  }

  async getTokenStatus(key: string, config: TokenBucketConfig): Promise<TokenStatus> {
    const now = new Date()

    const [record] = await db
      .select({
        tokens: rateLimitBucket.tokens,
        lastRefillAt: rateLimitBucket.lastRefillAt,
      })
      .from(rateLimitBucket)
      .where(eq(rateLimitBucket.key, key))
      .limit(1)

    if (!record) {
      return {
        tokensAvailable: config.maxTokens,
        maxTokens: config.maxTokens,
        lastRefillAt: now,
        nextRefillAt: new Date(now.getTime() + config.refillIntervalMs),
      }
    }

    const tokens = Math.max(0, Number.parseFloat(record.tokens))
    const elapsed = now.getTime() - record.lastRefillAt.getTime()
    const intervalsElapsed = Math.max(0, Math.floor(elapsed / config.refillIntervalMs))
    const refillAmount = intervalsElapsed * config.refillRate
    const tokensAvailable = Math.min(config.maxTokens, tokens + refillAmount)
    const lastRefillAt = new Date(
      record.lastRefillAt.getTime() + intervalsElapsed * config.refillIntervalMs
    )

    return {
      tokensAvailable,
      maxTokens: config.maxTokens,
      lastRefillAt,
      nextRefillAt: new Date(lastRefillAt.getTime() + config.refillIntervalMs),
    }
  }

  async resetBucket(key: string): Promise<void> {
    await db.delete(rateLimitBucket).where(eq(rateLimitBucket.key, key))
  }
}
