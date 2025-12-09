import { db } from '@sim/db'
import { rateLimitBucket } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import type {
  ConsumeResult,
  RateLimitStorageAdapter,
  TokenBucketConfig,
  TokenStatus,
} from './adapter'

export class DbTokenBucket implements RateLimitStorageAdapter {
  async consumeTokens(
    key: string,
    requestedTokens: number,
    config: TokenBucketConfig
  ): Promise<ConsumeResult> {
    const now = new Date()
    const nowMs = now.getTime()
    const nowIso = now.toISOString()

    const result = await db
      .insert(rateLimitBucket)
      .values({
        key,
        tokens: (config.maxTokens - requestedTokens).toString(),
        lastRefillAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: rateLimitBucket.key,
        set: {
          tokens: sql`
            CASE
              WHEN (
                LEAST(
                  ${config.maxTokens}::numeric,
                  ${rateLimitBucket.tokens}::numeric + (
                    FLOOR(
                      EXTRACT(EPOCH FROM (${nowIso}::timestamp - ${rateLimitBucket.lastRefillAt})) * 1000
                      / ${config.refillIntervalMs}
                    ) * ${config.refillRate}
                  )::numeric
                )
              ) >= ${requestedTokens}::numeric
              THEN LEAST(
                ${config.maxTokens}::numeric,
                ${rateLimitBucket.tokens}::numeric + (
                  FLOOR(
                    EXTRACT(EPOCH FROM (${nowIso}::timestamp - ${rateLimitBucket.lastRefillAt})) * 1000
                    / ${config.refillIntervalMs}
                  ) * ${config.refillRate}
                )::numeric
              ) - ${requestedTokens}::numeric
              ELSE ${rateLimitBucket.tokens}::numeric
            END
          `,
          lastRefillAt: sql`
            CASE
              WHEN FLOOR(
                EXTRACT(EPOCH FROM (${nowIso}::timestamp - ${rateLimitBucket.lastRefillAt})) * 1000
                / ${config.refillIntervalMs}
              ) > 0
              THEN ${rateLimitBucket.lastRefillAt} + (
                FLOOR(
                  EXTRACT(EPOCH FROM (${nowIso}::timestamp - ${rateLimitBucket.lastRefillAt})) * 1000
                  / ${config.refillIntervalMs}
                ) * ${config.refillIntervalMs} * INTERVAL '1 millisecond'
              )
              ELSE ${rateLimitBucket.lastRefillAt}
            END
          `,
          updatedAt: now,
        },
      })
      .returning({
        tokens: rateLimitBucket.tokens,
        lastRefillAt: rateLimitBucket.lastRefillAt,
      })

    const record = result[0]
    const tokens = Number.parseFloat(record.tokens)
    const lastRefillMs = record.lastRefillAt.getTime()
    const nextRefillAt = new Date(lastRefillMs + config.refillIntervalMs)

    const allowed = tokens >= 0

    return {
      allowed,
      tokensRemaining: Math.max(0, tokens),
      resetAt: nextRefillAt,
      retryAfterMs: allowed ? undefined : Math.max(0, nextRefillAt.getTime() - nowMs),
    }
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

    const tokens = Number.parseFloat(record.tokens)
    const elapsed = now.getTime() - record.lastRefillAt.getTime()
    const intervalsElapsed = Math.floor(elapsed / config.refillIntervalMs)
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
