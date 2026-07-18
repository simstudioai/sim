import { createLogger } from '@sim/logger'
import type { McpTool } from '@/lib/mcp/types'
import { MCP_CONSTANTS } from '@/lib/mcp/utils'
import type { McpCacheEntry, McpCacheMutationSet, McpCacheStorageAdapter } from './adapter'

const logger = createLogger('McpMemoryCache')

export class MemoryMcpCache implements McpCacheStorageAdapter {
  private cache = new Map<string, McpCacheEntry>()
  private mutationVersions = new Map<string, number>()
  private nextMutationId = 0
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

  async beginMutation(scopeKey: string): Promise<number> {
    const mutationId = Math.max(this.nextMutationId + 1, Date.now())
    this.nextMutationId = mutationId
    this.mutationVersions.set(scopeKey, mutationId)
    return mutationId
  }

  async setIfCurrentMutation(
    scopeKey: string,
    mutationId: number,
    key: string,
    tools: McpTool[],
    ttlMs: number
  ): Promise<boolean> {
    if (this.mutationVersions.get(scopeKey) !== mutationId) return false
    await this.set(key, tools, ttlMs)
    return true
  }

  async deleteIfCurrentMutation(
    scopeKey: string,
    mutationId: number,
    key: string
  ): Promise<boolean> {
    if (this.mutationVersions.get(scopeKey) !== mutationId) return false
    await this.delete(key)
    return true
  }

  async applyMutationIfCurrent(
    scopeKey: string,
    mutationId: number,
    setEntry: McpCacheMutationSet | null,
    deleteKeys: string[]
  ): Promise<boolean> {
    if (this.mutationVersions.get(scopeKey) !== mutationId) return false

    if (setEntry) {
      this.cache.set(setEntry.key, {
        tools: setEntry.tools,
        expiry: Date.now() + setEntry.ttlMs,
      })
    }
    for (const key of deleteKeys) this.cache.delete(key)
    this.evictIfNeeded()
    return true
  }

  async clear(): Promise<void> {
    for (const scopeKey of this.mutationVersions.keys()) {
      const mutationId = Math.max(this.nextMutationId + 1, Date.now())
      this.nextMutationId = mutationId
      this.mutationVersions.set(scopeKey, mutationId)
    }
    this.cache.clear()
  }

  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.cache.clear()
    this.mutationVersions.clear()
    logger.info('Memory cache disposed')
  }
}
