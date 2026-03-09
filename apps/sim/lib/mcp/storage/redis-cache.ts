import { createLogger } from '@sim/logger'
import type Redis from 'ioredis'
import type { McpTool } from '@/lib/mcp/types'
import type { McpCacheEntry, McpCacheStorageAdapter } from './adapter'

const logger = createLogger('McpRedisCache')

const REDIS_KEY_PREFIX = 'mcp:tools:'

export class RedisMcpCache implements McpCacheStorageAdapter {
  constructor(private redis: Redis) {}

  private getKey(key: string): string {
    return `${REDIS_KEY_PREFIX}${key}`
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
