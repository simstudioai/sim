import type Redis from 'ioredis'
import type {
  AtomicAdmissionOptions,
  AtomicAdmissionResult,
  ConsumeResult,
  RateLimitStorageAdapter,
  TokenBucketConfig,
  TokenBucketReservation,
  TokenStatus,
} from '@/lib/core/rate-limiter/storage/adapter'

const CONSUME_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local requested = tonumber(ARGV[2])
local maxTokens = tonumber(ARGV[3])
local refillRate = tonumber(ARGV[4])
local refillIntervalMs = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])

local bucket = redis.call('HMGET', key, 'tokens', 'lastRefillAt')
local tokens = tonumber(bucket[1])
local lastRefillAt = tonumber(bucket[2])

if tokens == nil then
  tokens = maxTokens
  lastRefillAt = now
end

local elapsed = now - lastRefillAt
local intervalsElapsed = math.max(0, math.floor(elapsed / refillIntervalMs))
tokens = math.min(maxTokens, math.max(0, tokens))
if intervalsElapsed > 0 then
  tokens = math.min(maxTokens, tokens + (intervalsElapsed * refillRate))
  lastRefillAt = lastRefillAt + (intervalsElapsed * refillIntervalMs)
end

local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'lastRefillAt', lastRefillAt)
redis.call('EXPIRE', key, ttl)

local nextRefillAt = lastRefillAt + refillIntervalMs
local intervalsUntilAdmission = math.max(1, math.ceil((requested - tokens) / refillRate))
local retryAt = lastRefillAt + intervalsUntilAdmission * refillIntervalMs

return {allowed, tostring(tokens), nextRefillAt, retryAt}
`

const ATOMIC_CONSUME_SCRIPT = `
local now = tonumber(ARGV[1])
local deadline = tonumber(ARGV[2])
local gateCount = tonumber(ARGV[3])
local serverTime = redis.call('TIME')
local serverNow = tonumber(serverTime[1]) * 1000 + math.floor(tonumber(serverTime[2]) / 1000)
if now >= deadline or serverNow >= deadline then return {0, 0} end
local wait = 0
for i = 1, gateCount do
  local untilAt = tonumber(redis.call('HGET', KEYS[i], 'blockedUntil')) or 0
  wait = math.max(wait, untilAt - now)
end
local balances = {}
for i = gateCount + 1, #KEYS do
  local offset = 4 + (i - gateCount - 1) * 4
  local cost = tonumber(ARGV[offset])
  local maximum = tonumber(ARGV[offset + 1])
  local rate = tonumber(ARGV[offset + 2])
  local interval = tonumber(ARGV[offset + 3])
  local bucket = redis.call('HMGET', KEYS[i], 'tokens', 'lastRefillAt')
  local tokens = tonumber(bucket[1]) or maximum
  local refillAt = tonumber(bucket[2]) or now
  local elapsed = math.max(0, math.floor((now - refillAt) / interval))
  tokens = math.min(maximum, math.max(0, tokens) + elapsed * rate)
  refillAt = refillAt + elapsed * interval
  if tokens < cost then
    wait = math.max(wait, refillAt + math.ceil((cost - tokens) / rate) * interval - now)
  end
  balances[i] = {tokens - cost, refillAt, math.ceil((math.ceil(maximum / rate) + 1) * interval)}
end
if wait > 0 then return {0, wait} end
for i = gateCount + 1, #KEYS do
  local balance = balances[i]
  redis.call('HSET', KEYS[i], 'tokens', balance[1], 'lastRefillAt', balance[2])
  redis.call('PEXPIRE', KEYS[i], balance[3])
end
return {1, 0}
`

const SET_COOLDOWN_SCRIPT = `
local current = tonumber(redis.call('HGET', KEYS[1], 'blockedUntil')) or 0
local untilAt = math.max(current, tonumber(ARGV[1]))
redis.call('HSET', KEYS[1], 'blockedUntil', untilAt)
redis.call('PEXPIREAT', KEYS[1], untilAt)
return untilAt
`

const STATUS_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local maxTokens = tonumber(ARGV[2])
local refillRate = tonumber(ARGV[3])
local refillIntervalMs = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'lastRefillAt')
local tokens = tonumber(bucket[1])
local lastRefillAt = tonumber(bucket[2])

if tokens == nil then
  tokens = maxTokens
  lastRefillAt = now
end

local elapsed = now - lastRefillAt
local intervalsElapsed = math.max(0, math.floor(elapsed / refillIntervalMs))
tokens = math.min(maxTokens, math.max(0, tokens))
if intervalsElapsed > 0 then
  tokens = math.min(maxTokens, tokens + (intervalsElapsed * refillRate))
  lastRefillAt = lastRefillAt + (intervalsElapsed * refillIntervalMs)
end

local nextRefillAt = lastRefillAt + refillIntervalMs

return {tostring(tokens), maxTokens, lastRefillAt, nextRefillAt}
`

export class RedisTokenBucket implements RateLimitStorageAdapter {
  constructor(private redis: Redis) {}

  async consumeTokens(
    key: string,
    tokens: number,
    config: TokenBucketConfig
  ): Promise<ConsumeResult> {
    const now = Date.now()
    /** Expiry may reset a bucket only after it could have refilled completely. */
    const ttl = Math.ceil(
      ((Math.ceil(config.maxTokens / config.refillRate) + 1) * config.refillIntervalMs) / 1000
    )

    const result = (await this.redis.eval(
      CONSUME_SCRIPT,
      1,
      `ratelimit:tb:${key}`,
      now,
      tokens,
      config.maxTokens,
      config.refillRate,
      config.refillIntervalMs,
      ttl
    )) as [number, string, number, number]

    const [allowed, remaining, nextRefill, retryAt] = result

    return {
      allowed: allowed === 1,
      tokensRemaining: Number(remaining),
      resetAt: new Date(nextRefill),
      retryAfterMs: allowed === 1 ? undefined : Math.max(0, retryAt - now),
    }
  }

  async consumeTokensAtomically(
    reservations: readonly TokenBucketReservation[],
    options: AtomicAdmissionOptions
  ): Promise<AtomicAdmissionResult> {
    options.signal?.throwIfAborted()
    const keys = [...options.cooldownKeys, ...reservations.map((item) => item.key)]
    const [allowed, retryAfterMs] = (await this.redis.eval(
      ATOMIC_CONSUME_SCRIPT,
      keys.length,
      ...keys.map((key) => `ratelimit:tb:${key}`),
      Date.now(),
      options.deadlineAt,
      options.cooldownKeys.length,
      ...reservations.flatMap(({ cost, config }) => [
        cost,
        config.maxTokens,
        config.refillRate,
        config.refillIntervalMs,
      ])
    )) as [number, number]
    return { allowed: allowed === 1, retryAfterMs }
  }

  async getCooldownUntil(key: string): Promise<Date | null> {
    const value = await this.redis.hget(`ratelimit:tb:${key}`, 'blockedUntil')
    return value === null ? null : new Date(Number(value))
  }

  async setCooldownUntil(key: string, until: Date): Promise<void> {
    await this.redis.eval(SET_COOLDOWN_SCRIPT, 1, `ratelimit:tb:${key}`, until.getTime())
  }

  async getTokenStatus(key: string, config: TokenBucketConfig): Promise<TokenStatus> {
    const now = Date.now()

    const result = (await this.redis.eval(
      STATUS_SCRIPT,
      1,
      `ratelimit:tb:${key}`,
      now,
      config.maxTokens,
      config.refillRate,
      config.refillIntervalMs
    )) as [string, number, number, number]

    const [tokensAvailable, maxTokens, lastRefillAt, nextRefillAt] = result

    return {
      tokensAvailable: Number(tokensAvailable),
      maxTokens,
      lastRefillAt: new Date(lastRefillAt),
      nextRefillAt: new Date(nextRefillAt),
    }
  }

  async resetBucket(key: string): Promise<void> {
    await this.redis.del(`ratelimit:tb:${key}`)
  }
}
