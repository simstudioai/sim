import type Redis from 'ioredis'
import type {
  ConsumeResult,
  RateLimitStorageAdapter,
  TokenBucketConfig,
  TokenStatus,
} from './adapter'

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
local intervalsElapsed = math.floor(elapsed / refillIntervalMs)
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

return {allowed, tokens, lastRefillAt, nextRefillAt}
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
local intervalsElapsed = math.floor(elapsed / refillIntervalMs)
if intervalsElapsed > 0 then
  tokens = math.min(maxTokens, tokens + (intervalsElapsed * refillRate))
  lastRefillAt = lastRefillAt + (intervalsElapsed * refillIntervalMs)
end

local nextRefillAt = lastRefillAt + refillIntervalMs

return {tokens, maxTokens, lastRefillAt, nextRefillAt}
`

export class RedisTokenBucket implements RateLimitStorageAdapter {
  constructor(private redis: Redis) {}

  async consumeTokens(
    key: string,
    tokens: number,
    config: TokenBucketConfig
  ): Promise<ConsumeResult> {
    const now = Date.now()
    const ttl = Math.ceil((config.refillIntervalMs * 2) / 1000)

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
    )) as [number, number, number, number]

    const [allowed, remaining, , nextRefill] = result

    return {
      allowed: allowed === 1,
      tokensRemaining: remaining,
      resetAt: new Date(nextRefill),
      retryAfterMs: allowed === 1 ? undefined : Math.max(0, nextRefill - now),
    }
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
    )) as [number, number, number, number]

    const [tokensAvailable, maxTokens, lastRefillAt, nextRefillAt] = result

    return {
      tokensAvailable,
      maxTokens,
      lastRefillAt: new Date(lastRefillAt),
      nextRefillAt: new Date(nextRefillAt),
    }
  }

  async resetBucket(key: string): Promise<void> {
    await this.redis.del(`ratelimit:tb:${key}`)
  }
}
