import { createLogger } from '@sim/logger'
import type Redis from 'ioredis'
import { env } from '@/lib/core/config/env'
import type { PaginatedCacheStorageAdapter } from '@/lib/paginated-cache/adapter'
import type { CachedPage, CacheMetadata } from '@/lib/paginated-cache/types'

const logger = createLogger('RedisPaginatedCache')

const REDIS_KEY_PREFIX = 'pagcache:'

/** Safety-net TTL: 2× the max async execution timeout. Explicit cleanup is the primary mechanism. */
const DEFAULT_TTL_MS = Number(env.EXECUTION_TIMEOUT_ASYNC_ENTERPRISE) * 1000 * 2

export class RedisPaginatedCache implements PaginatedCacheStorageAdapter {
  constructor(
    private redis: Redis,
    private ttlMs: number = DEFAULT_TTL_MS
  ) {}

  private getMetaKey(cacheId: string): string {
    return `${REDIS_KEY_PREFIX}meta:${cacheId}`
  }

  private getPageKey(cacheId: string, pageIndex: number): string {
    return `${REDIS_KEY_PREFIX}page:${cacheId}:${pageIndex}`
  }

  async storePage(cacheId: string, pageIndex: number, items: unknown[]): Promise<void> {
    try {
      const page: CachedPage = {
        pageIndex,
        itemCount: items.length,
        items,
        storedAt: Date.now(),
      }
      const key = this.getPageKey(cacheId, pageIndex)
      await this.redis.set(key, JSON.stringify(page), 'PX', this.ttlMs)
    } catch (error) {
      logger.error('Failed to store page', { cacheId, pageIndex, error })
      throw error
    }
  }

  async storeMetadata(cacheId: string, metadata: CacheMetadata): Promise<void> {
    try {
      const key = this.getMetaKey(cacheId)
      await this.redis.set(key, JSON.stringify(metadata), 'PX', this.ttlMs)
    } catch (error) {
      logger.error('Failed to store metadata', { cacheId, error })
      throw error
    }
  }

  async getPage(cacheId: string, pageIndex: number): Promise<CachedPage | null> {
    try {
      const key = this.getPageKey(cacheId, pageIndex)
      const data = await this.redis.get(key)

      if (!data) {
        return null
      }

      try {
        return JSON.parse(data) as CachedPage
      } catch {
        logger.warn('Corrupted page entry, deleting:', key)
        await this.redis.del(key)
        return null
      }
    } catch (error) {
      logger.error('Failed to get page', { cacheId, pageIndex, error })
      throw error
    }
  }

  async getMetadata(cacheId: string): Promise<CacheMetadata | null> {
    try {
      const key = this.getMetaKey(cacheId)
      const data = await this.redis.get(key)

      if (!data) {
        return null
      }

      try {
        return JSON.parse(data) as CacheMetadata
      } catch {
        logger.warn('Corrupted metadata entry, deleting:', key)
        await this.redis.del(key)
        return null
      }
    } catch (error) {
      logger.error('Failed to get metadata', { cacheId, error })
      throw error
    }
  }

  async getAllPages(cacheId: string, totalPages: number): Promise<CachedPage[]> {
    try {
      const keys = Array.from({ length: totalPages }, (_, i) => this.getPageKey(cacheId, i))
      const results = await this.redis.mget(...keys)

      const pages: CachedPage[] = []
      for (let i = 0; i < results.length; i++) {
        const raw = results[i]
        if (!raw) {
          throw new Error(`Missing page ${i} for cache entry ${cacheId}`)
        }

        try {
          pages.push(JSON.parse(raw) as CachedPage)
        } catch {
          throw new Error(`Corrupted page ${i} for cache entry ${cacheId}`)
        }
      }

      return pages
    } catch (error) {
      logger.error('Failed to get all pages', { cacheId, totalPages, error })
      throw error
    }
  }

  async delete(cacheId: string): Promise<void> {
    try {
      await this.redis.del(this.getMetaKey(cacheId))

      let cursor = '0'
      let deletedCount = 0
      const pattern = `${REDIS_KEY_PREFIX}page:${cacheId}:*`

      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
        cursor = nextCursor

        if (keys.length > 0) {
          await this.redis.del(...keys)
          deletedCount += keys.length
        }
      } while (cursor !== '0')

      logger.info(`Deleted cache entry ${cacheId} (${deletedCount} page keys)`)
    } catch (error) {
      logger.error('Failed to delete cache entry', { cacheId, error })
      throw error
    }
  }
}
