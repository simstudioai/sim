import { db } from '@sim/db'
import { rateLimitBucket } from '@sim/db/schema'
import { eq, inArray, sql } from 'drizzle-orm'
import type {
  AtomicAdmissionOptions,
  AtomicAdmissionResult,
  ConsumeResult,
  RateLimitStorageAdapter,
  TokenBucketConfig,
  TokenBucketReservation,
  TokenStatus,
} from '@/lib/core/rate-limiter/storage/adapter'

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

  /** Locks all dimensions and provider gates before spending any capacity. */
  async consumeTokensAtomically(
    reservations: readonly TokenBucketReservation[],
    options: AtomicAdmissionOptions
  ): Promise<AtomicAdmissionResult> {
    options.signal?.throwIfAborted()
    if (Date.now() >= options.deadlineAt) return { allowed: false, retryAfterMs: 0 }
    return db.transaction(async (tx) => {
      const remainingMs = Math.max(1, options.deadlineAt - Date.now())
      await tx.execute(
        sql`SELECT set_config('statement_timeout', ${String(remainingMs)}, true), set_config('lock_timeout', ${String(remainingMs)}, true)`
      )
      const keys = [
        ...new Set([...options.cooldownKeys, ...reservations.map((item) => item.key)]),
      ].sort()
      const createdAt = new Date()
      for (const key of keys) {
        const reservation = reservations.find((item) => item.key === key)
        await tx
          .insert(rateLimitBucket)
          .values({
            key,
            tokens: String(reservation?.config.maxTokens ?? 0),
            lastRefillAt: createdAt,
            updatedAt: createdAt,
          })
          .onConflictDoNothing()
      }
      const rows = await tx
        .select()
        .from(rateLimitBucket)
        .where(inArray(rateLimitBucket.key, keys))
        .orderBy(rateLimitBucket.key)
        .for('update')
        .limit(keys.length)
      options.signal?.throwIfAborted()
      const now = Date.now()
      if (now >= options.deadlineAt) return { allowed: false, retryAfterMs: 0 }
      let retryAfterMs = 0
      for (const key of options.cooldownKeys) {
        const row = rows.find((candidate) => candidate.key === key)
        retryAfterMs = Math.max(retryAfterMs, (row?.blockedUntil?.getTime() ?? 0) - now)
      }
      const balances = reservations.map((reservation) => {
        const row = rows.find((candidate) => candidate.key === reservation.key)
        if (!row) throw new Error('Rate limit bucket disappeared during admission')
        const { config, cost } = reservation
        const elapsed = Math.max(
          0,
          Math.floor((now - row.lastRefillAt.getTime()) / config.refillIntervalMs)
        )
        const available = Math.min(
          config.maxTokens,
          Math.max(0, Number(row.tokens)) + elapsed * config.refillRate
        )
        const lastRefillAt = new Date(
          row.lastRefillAt.getTime() + elapsed * config.refillIntervalMs
        )
        if (available < cost) {
          retryAfterMs = Math.max(
            retryAfterMs,
            lastRefillAt.getTime() +
              Math.ceil((cost - available) / config.refillRate) * config.refillIntervalMs -
              now
          )
        }
        return { reservation, available, lastRefillAt }
      })
      if (retryAfterMs > 0) return { allowed: false, retryAfterMs }
      options.signal?.throwIfAborted()
      for (const { reservation, available, lastRefillAt } of balances) {
        await tx
          .update(rateLimitBucket)
          .set({
            tokens: String(available - reservation.cost),
            lastRefillAt,
            updatedAt: new Date(now),
          })
          .where(eq(rateLimitBucket.key, reservation.key))
      }
      options.signal?.throwIfAborted()
      return { allowed: true, retryAfterMs: 0 }
    })
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
