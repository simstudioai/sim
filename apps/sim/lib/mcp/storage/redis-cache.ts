import { createLogger } from '@sim/logger'
import type Redis from 'ioredis'
import type { McpTool } from '@/lib/mcp/types'
import type { McpCacheEntry, McpCacheStorageAdapter } from './adapter'

const logger = createLogger('McpRedisCache')

const REDIS_KEY_PREFIX = 'mcp:tools:'
const MUTATION_KEY_PREFIX = 'mcp:tools-mutation:'
const MUTATION_TTL_MS = 24 * 60 * 60 * 1000

const SET_IF_CURRENT_MUTATION = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
return 1
`

const DELETE_IF_CURRENT_MUTATION = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('DEL', KEYS[2])
return 1
`

export class RedisMcpCache implements McpCacheStorageAdapter {
  constructor(private redis: Redis) {}

  private getKey(key: string): string {
    return `${REDIS_KEY_PREFIX}${key}`
  }

  private getMutationKey(scopeKey: string): string {
    return `${MUTATION_KEY_PREFIX}${scopeKey}`
  }

  async get(key: string): Promise<McpCacheEntry | null> {
    try {
      const redisKey = this.getKey(key)
      const data = await this.redis.get(redisKey)

      if (!data) {
        return null
      }

      try {
        return JSON.parse(data) as McpCacheEntry
      } catch {
        // Corrupted data - delete and treat as miss
        logger.warn('Corrupted cache entry, deleting:', redisKey)
        await this.redis.del(redisKey)
        return null
      }
    } catch (error) {
      logger.error('Redis cache get error:', error)
      throw error
    }
  }

  async set(key: string, tools: McpTool[], ttlMs: number): Promise<void> {
    try {
      const now = Date.now()
      const entry: McpCacheEntry = {
        tools,
        expiry: now + ttlMs,
      }

      await this.redis.set(this.getKey(key), JSON.stringify(entry), 'PX', ttlMs)
    } catch (error) {
      logger.error('Redis cache set error:', error)
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(this.getKey(key))
    } catch (error) {
      logger.error('Redis cache delete error:', error)
      throw error
    }
  }

  async beginMutation(scopeKey: string): Promise<number> {
    try {
      const mutationKey = this.getMutationKey(scopeKey)
      const transaction = this.redis.multi()
      transaction.incr(mutationKey)
      transaction.pexpire(mutationKey, MUTATION_TTL_MS)
      const results = await transaction.exec()
      const mutationId = results?.[0]?.[1]
      if (typeof mutationId !== 'number') {
        throw new Error('Redis did not return an MCP cache mutation id')
      }
      return mutationId
    } catch (error) {
      logger.error('Redis cache mutation start error:', error)
      throw error
    }
  }

  async setIfCurrentMutation(
    scopeKey: string,
    mutationId: number,
    key: string,
    tools: McpTool[],
    ttlMs: number
  ): Promise<boolean> {
    try {
      const entry: McpCacheEntry = {
        tools,
        expiry: Date.now() + ttlMs,
      }
      const result = await this.redis.eval(
        SET_IF_CURRENT_MUTATION,
        2,
        this.getMutationKey(scopeKey),
        this.getKey(key),
        String(mutationId),
        JSON.stringify(entry),
        String(ttlMs)
      )
      return result === 1
    } catch (error) {
      logger.error('Redis conditional cache set error:', error)
      throw error
    }
  }

  async deleteIfCurrentMutation(
    scopeKey: string,
    mutationId: number,
    key: string
  ): Promise<boolean> {
    try {
      const result = await this.redis.eval(
        DELETE_IF_CURRENT_MUTATION,
        2,
        this.getMutationKey(scopeKey),
        this.getKey(key),
        String(mutationId)
      )
      return result === 1
    } catch (error) {
      logger.error('Redis conditional cache delete error:', error)
      throw error
    }
  }

  async clear(): Promise<void> {
    try {
      let cursor = '0'
      let deletedCount = 0

      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${REDIS_KEY_PREFIX}*`,
          'COUNT',
          100
        )
        cursor = nextCursor

        if (keys.length > 0) {
          await this.redis.del(...keys)
          deletedCount += keys.length
        }
      } while (cursor !== '0')

      cursor = '0'
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${MUTATION_KEY_PREFIX}*`,
          'COUNT',
          100
        )
        cursor = nextCursor
        if (keys.length > 0) {
          const transaction = this.redis.multi()
          for (const key of keys) {
            transaction.incr(key)
            transaction.pexpire(key, MUTATION_TTL_MS)
          }
          await transaction.exec()
        }
      } while (cursor !== '0')

      logger.debug(`Cleared ${deletedCount} MCP cache entries from Redis`)
    } catch (error) {
      logger.error('Redis cache clear error:', error)
      throw error
    }
  }

  dispose(): void {
    // Redis client is managed externally, nothing to dispose
    logger.info('Redis cache adapter disposed')
  }
}
