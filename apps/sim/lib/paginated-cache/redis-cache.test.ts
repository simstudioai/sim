/**
 * @vitest-environment node
 */
import { createMockRedis, loggerMock, type MockRedis } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@/lib/core/config/env', () => ({
  env: { EXECUTION_TIMEOUT_ASYNC_ENTERPRISE: '5400' },
}))

import { RedisPaginatedCache } from '@/lib/paginated-cache/redis-cache'
import type { CacheMetadata } from '@/lib/paginated-cache/types'

/** 2× the mocked EXECUTION_TIMEOUT_ASYNC_ENTERPRISE (5400s) */
const EXPECTED_DEFAULT_TTL_MS = 5400 * 1000 * 2

describe('RedisPaginatedCache', () => {
  let mockRedis: MockRedis
  let cache: RedisPaginatedCache

  beforeEach(() => {
    vi.clearAllMocks()
    mockRedis = createMockRedis()
    cache = new RedisPaginatedCache(mockRedis as never)
  })

  describe('storePage', () => {
    it('stores JSON with correct key pattern and PX TTL', async () => {
      const items = [{ id: 1 }, { id: 2 }]

      await cache.storePage('cache-123', 0, items)

      expect(mockRedis.set).toHaveBeenCalledOnce()
      const [key, value, pxFlag, ttl] = mockRedis.set.mock.calls[0]
      expect(key).toBe('pagcache:page:cache-123:0')
      expect(pxFlag).toBe('PX')
      expect(ttl).toBe(EXPECTED_DEFAULT_TTL_MS)

      const parsed = JSON.parse(value)
      expect(parsed.pageIndex).toBe(0)
      expect(parsed.itemCount).toBe(2)
      expect(parsed.items).toEqual(items)
      expect(typeof parsed.storedAt).toBe('number')
    })

    it('propagates Redis errors', async () => {
      mockRedis.set.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(cache.storePage('cache-123', 0, [])).rejects.toThrow('ECONNREFUSED')
    })
  })

  describe('storeMetadata', () => {
    it('stores JSON with correct key pattern and PX TTL', async () => {
      const metadata: CacheMetadata = {
        cacheId: 'cache-123',
        totalPages: 3,
        totalItems: 150,
        pageField: 'tickets',
      }

      await cache.storeMetadata('cache-123', metadata)

      expect(mockRedis.set).toHaveBeenCalledOnce()
      const [key, value, pxFlag, ttl] = mockRedis.set.mock.calls[0]
      expect(key).toBe('pagcache:meta:cache-123')
      expect(pxFlag).toBe('PX')
      expect(ttl).toBe(EXPECTED_DEFAULT_TTL_MS)

      const parsed = JSON.parse(value)
      expect(parsed).toEqual(metadata)
    })
  })

  describe('getPage', () => {
    it('returns parsed CachedPage when data exists', async () => {
      const page = { pageIndex: 0, itemCount: 2, items: [{ id: 1 }, { id: 2 }], storedAt: 100 }
      mockRedis.get.mockResolvedValue(JSON.stringify(page))

      const result = await cache.getPage('cache-123', 0)

      expect(mockRedis.get).toHaveBeenCalledWith('pagcache:page:cache-123:0')
      expect(result).toEqual(page)
    })

    it('returns null when key is missing', async () => {
      const result = await cache.getPage('cache-123', 0)

      expect(result).toBeNull()
    })

    it('deletes key and returns null when JSON is corrupted', async () => {
      mockRedis.get.mockResolvedValue('not-valid-json{{{')

      const result = await cache.getPage('cache-123', 0)

      expect(result).toBeNull()
      expect(mockRedis.del).toHaveBeenCalledWith('pagcache:page:cache-123:0')
    })
  })

  describe('getMetadata', () => {
    it('returns parsed CacheMetadata when data exists', async () => {
      const metadata: CacheMetadata = {
        cacheId: 'cache-123',
        totalPages: 3,
        totalItems: 150,
        pageField: 'tickets',
      }
      mockRedis.get.mockResolvedValue(JSON.stringify(metadata))

      const result = await cache.getMetadata('cache-123')

      expect(mockRedis.get).toHaveBeenCalledWith('pagcache:meta:cache-123')
      expect(result).toEqual(metadata)
    })

    it('returns null when metadata is missing', async () => {
      const result = await cache.getMetadata('cache-123')

      expect(result).toBeNull()
    })
  })

  describe('getAllPages', () => {
    it('calls mget with correct keys and returns parsed pages in order', async () => {
      const page0 = { pageIndex: 0, itemCount: 1, items: ['a'], storedAt: 100 }
      const page1 = { pageIndex: 1, itemCount: 1, items: ['b'], storedAt: 200 }
      const page2 = { pageIndex: 2, itemCount: 1, items: ['c'], storedAt: 300 }
      mockRedis.mget.mockResolvedValue([
        JSON.stringify(page0),
        JSON.stringify(page1),
        JSON.stringify(page2),
      ])

      const result = await cache.getAllPages('cache-123', 3)

      expect(mockRedis.mget).toHaveBeenCalledWith(
        'pagcache:page:cache-123:0',
        'pagcache:page:cache-123:1',
        'pagcache:page:cache-123:2'
      )
      expect(result).toEqual([page0, page1, page2])
    })

    it('throws when a page is missing', async () => {
      mockRedis.mget.mockResolvedValue([JSON.stringify({ pageIndex: 0 }), null])

      await expect(cache.getAllPages('cache-123', 2)).rejects.toThrow(
        'Missing page 1 for cache entry cache-123'
      )
    })

    it('throws when a page is corrupted', async () => {
      mockRedis.mget.mockResolvedValue([JSON.stringify({ pageIndex: 0 }), 'corrupt{{{'])

      await expect(cache.getAllPages('cache-123', 2)).rejects.toThrow(
        'Corrupted page 1 for cache entry cache-123'
      )
    })
  })

  describe('delete', () => {
    it('deletes meta key and scans+deletes page keys', async () => {
      mockRedis.scan
        .mockResolvedValueOnce(['42', ['pagcache:page:cache-123:0', 'pagcache:page:cache-123:1']])
        .mockResolvedValueOnce(['0', ['pagcache:page:cache-123:2']])

      await cache.delete('cache-123')

      expect(mockRedis.del).toHaveBeenCalledWith('pagcache:meta:cache-123')
      expect(mockRedis.del).toHaveBeenCalledWith(
        'pagcache:page:cache-123:0',
        'pagcache:page:cache-123:1'
      )
      expect(mockRedis.del).toHaveBeenCalledWith('pagcache:page:cache-123:2')
    })
  })

  describe('custom TTL', () => {
    it('uses the TTL passed in the constructor', async () => {
      const customTtl = 5 * 60 * 1000
      const customCache = new RedisPaginatedCache(mockRedis as never, customTtl)

      await customCache.storePage('cache-456', 0, [{ id: 1 }])

      const [, , , ttl] = mockRedis.set.mock.calls[0]
      expect(ttl).toBe(customTtl)
    })
  })
})
