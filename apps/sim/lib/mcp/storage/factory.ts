import type { McpCacheStorageAdapter } from './adapter'
import { RedisMcpCache } from './redis-cache'

let cachedAdapter: McpCacheStorageAdapter | null = null

/**
 * The MCP cache storage adapter, backed by the shared Redis client.
 */
export function createMcpCacheAdapter(): McpCacheStorageAdapter {
  if (cachedAdapter) {
    return cachedAdapter
  }
  cachedAdapter = new RedisMcpCache()
  return cachedAdapter
}
