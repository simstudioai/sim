import { sleep } from '@sim/utils/helpers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { McpTool } from '@/lib/mcp/types'
import { MemoryMcpCache } from './memory-cache'

describe('MemoryMcpCache', () => {
  let cache: MemoryMcpCache

  const createTool = (name: string): McpTool => ({
    name,
    description: `Test tool: ${name}`,
    inputSchema: { type: 'object' },
    serverId: 'server-1',
    serverName: 'Test Server',
  })

  beforeEach(() => {
    cache = new MemoryMcpCache()
  })

  afterEach(() => {
    cache.dispose()
  })

  describe('get', () => {
    it('returns cached entry when valid', async () => {
      const tools = [createTool('tool-1')]
      await cache.set('key-1', tools, 60000)

      const result = await cache.get('key-1')

      expect(result).not.toBeNull()
      expect(result?.tools).toEqual(tools)
    })

    it('returns null for expired entry', async () => {
      const tools = [createTool('tool-1')]
      // Set with 0 TTL so it expires immediately
      await cache.set('key-1', tools, 0)

      // Wait a tiny bit to ensure expiry
      await sleep(5)

      const result = await cache.get('key-1')
      expect(result).toBeNull()
    })

    it('returns a copy of tools to prevent mutation', async () => {
      const tools = [createTool('tool-1')]
      await cache.set('key-1', tools, 60000)

      const result1 = await cache.get('key-1')
      const result2 = await cache.get('key-1')

      expect(result1).not.toBe(result2)
      expect(result1?.tools).toEqual(result2?.tools)
    })
  })

  describe('eviction policy', () => {
    it('evicts oldest entries when max size is exceeded', async () => {
      // Create a cache and add more entries than MAX_CACHE_SIZE (1000)
      const tools = [createTool('tool')]

      // Add 1005 entries (5 over the limit of 1000)
      for (let i = 0; i < 1005; i++) {
        await cache.set(`key-${i}`, tools, 60000)
      }

      // The oldest entries (first 5) should be evicted
      expect(await cache.get('key-0')).toBeNull()
      expect(await cache.get('key-1')).toBeNull()
      expect(await cache.get('key-2')).toBeNull()
      expect(await cache.get('key-3')).toBeNull()
      expect(await cache.get('key-4')).toBeNull()

      // Newer entries should still exist
      expect(await cache.get('key-1004')).not.toBeNull()
      expect(await cache.get('key-1000')).not.toBeNull()
    })
  })
})
