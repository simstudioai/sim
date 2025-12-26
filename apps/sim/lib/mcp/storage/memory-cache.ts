import { createLogger } from '@sim/logger'
import type { McpTool } from '@/lib/mcp/types'
import { MCP_CONSTANTS } from '@/lib/mcp/utils'
import type { McpCacheEntry, McpCacheStorageAdapter } from './adapter'

const logger = createLogger('McpMemoryCache')

export class MemoryMcpCache implements McpCacheStorageAdapter {
  private cache = new Map<string, McpCacheEntry>()
  private readonly maxCacheSize = MCP_CONSTANTS.MAX_CACHE_SIZE
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    this.startPeriodicCleanup()
  }

  private startPeriodicCleanup(): void {
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupExpiredEntries()
      },
      5 * 60 * 1000 // 5 minutes
    )
    // Don't keep Node process alive just for cache cleanup
    this.cleanupInterval.unref()
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now()
    const expiredKeys: string[] = []

    this.cache.forEach((entry, key) => {
      if (entry.expiry <= now) {
        expiredKeys.push(key)
      }
    })

    expiredKeys.forEach((key) => this.cache.delete(key))

    if (expiredKeys.length > 0) {
      logger.debug(`Cleaned up ${expiredKeys.length} expired cache entries`)
    }
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxCacheSize) {
      return
    }

    // Evict oldest entries (by insertion order - Map maintains order)
    const entriesToRemove = this.cache.size - this.maxCacheSize
    const keys = Array.from(this.cache.keys()).slice(0, entriesToRemove)
    keys.forEach((key) => this.cache.delete(key))

    logger.debug(`Evicted ${entriesToRemove} cache entries`)
  }

  async get(key: string): Promise<McpCacheEntry | null> {
    const entry = this.cache.get(key)
    const now = Date.now()

    if (!entry || entry.expiry <= now) {
      if (entry) {
        this.cache.delete(key)
      }
      return null
    }

    // Return copy to prevent caller from mutating cache
    return {
      tools: entry.tools,
      expiry: entry.expiry,
    }
  }

  async set(key: string, tools: McpTool[], ttlMs: number): Promise<void> {
    const now = Date.now()
    const entry: McpCacheEntry = {
      tools,
      expiry: now + ttlMs,
    }

    this.cache.set(key, entry)
    this.evictIfNeeded()
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async clear(): Promise<void> {
    this.cache.clear()
  }

  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.cache.clear()
    logger.info('Memory cache disposed')
  }
}
