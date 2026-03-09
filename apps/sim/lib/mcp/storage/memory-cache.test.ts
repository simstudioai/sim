import { loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => loggerMock)

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
    it('returns null for non-existent key', async () => {
      const result = await cache.get('non-existent-key')
      expect(result).toBeNull()
    })

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
      await new Promise((resolve) => setTimeout(resolve, 5))

      const result = await cache.get('key-1')
      expect(result).toBeNull()
    })

    it('removes expired entry from cache on get', async () => {
      const tools = [createTool('tool-1')]
      await cache.set('key-1', tools, 1) // 1ms TTL

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 10))

      // First get should return null and remove entry
      await cache.get('key-1')

      // Entry should be removed (internal state)
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

  describe('set', () => {
    it('stores tools with correct expiry', async () => {
      const tools = [createTool('tool-1')]
      const ttl = 60000

      const beforeSet = Date.now()
      await cache.set('key-1', tools, ttl)
      const afterSet = Date.now()

      const result = await cache.get('key-1')

      expect(result).not.toBeNull()
      expect(result?.expiry).toBeGreaterThanOrEqual(beforeSet + ttl)
      expect(result?.expiry).toBeLessThanOrEqual(afterSet + ttl)
    })

    it('overwrites existing entry with same key', async () => {
      const tools1 = [createTool('tool-1')]
      const tools2 = [createTool('tool-2'), createTool('tool-3')]

      await cache.set('key-1', tools1, 60000)
      await cache.set('key-1', tools2, 60000)

      const result = await cache.get('key-1')

      expect(result?.tools).toEqual(tools2)
      expect(result?.tools.length).toBe(2)
    })

    it('handles empty tools array', async () => {
      await cache.set('key-1', [], 60000)

      const result = await cache.get('key-1')

      expect(result).not.toBeNull()
      expect(result?.tools).toEqual([])
    })

    it('handles multiple keys', async () => {
      const tools1 = [createTool('tool-1')]
      const tools2 = [createTool('tool-2')]

      await cache.set('key-1', tools1, 60000)
      await cache.set('key-2', tools2, 60000)

      const result1 = await cache.get('key-1')
      const result2 = await cache.get('key-2')

      expect(result1?.tools).toEqual(tools1)
      expect(result2?.tools).toEqual(tools2)
    })
  })

  describe('delete', () => {
    it('removes entry from cache', async () => {
      const tools = [createTool('tool-1')]
      await cache.set('key-1', tools, 60000)

      await cache.delete('key-1')

      const result = await cache.get('key-1')
      expect(result).toBeNull()
    })

    it('does not throw for non-existent key', async () => {
      // Should complete without throwing
      await cache.delete('non-existent')
      // If we get here, it worked
      expect(true).toBe(true)
    })

    it('does not affect other entries', async () => {
      const tools1 = [createTool('tool-1')]
      const tools2 = [createTool('tool-2')]

      await cache.set('key-1', tools1, 60000)
      await cache.set('key-2', tools2, 60000)

      await cache.delete('key-1')

      const result1 = await cache.get('key-1')
      const result2 = await cache.get('key-2')

      expect(result1).toBeNull()
      expect(result2?.tools).toEqual(tools2)
    })
  })

  describe('clear', () => {
    it('removes all entries from cache', async () => {
      const tools = [createTool('tool-1')]

      await cache.set('key-1', tools, 60000)
      await cache.set('key-2', tools, 60000)
      await cache.set('key-3', tools, 60000)

      await cache.clear()

      expect(await cache.get('key-1')).toBeNull()
      expect(await cache.get('key-2')).toBeNull()
      expect(await cache.get('key-3')).toBeNull()
    })

    it('works on empty cache', async () => {
      // Should complete without throwing
      await cache.clear()
      // If we get here, it worked
      expect(true).toBe(true)
    })
  })

  describe('dispose', () => {
    it('clears the cache', async () => {
      const tools = [createTool('tool-1')]
      await cache.set('key-1', tools, 60000)

      cache.dispose()

      const result = await cache.get('key-1')
      expect(result).toBeNull()
    })

    it('can be called multiple times', () => {
      cache.dispose()
      expect(() => cache.dispose()).not.toThrow()
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

  describe('TTL behavior', () => {
    it('entry is valid before expiry', async () => {
      const tools = [createTool('tool-1')]
      await cache.set('key-1', tools, 10000) // 10 seconds

      // Should be valid immediately
      const result = await cache.get('key-1')
      expect(result).not.toBeNull()
    })

    it('entry expires with very short TTL', async () => {
      const tools = [createTool('tool-1')]
      await cache.set('key-1', tools, 1) // 1 millisecond

      // Wait past expiry
      await new Promise((resolve) => setTimeout(resolve, 10))

      const result = await cache.get('key-1')
      expect(result).toBeNull()
    })

    it('supports long TTL', async () => {
      const tools = [createTool('tool-1')]
      const oneHour = 60 * 60 * 1000
      await cache.set('key-1', tools, oneHour)

      // Should be valid immediately
      const result = await cache.get('key-1')
      expect(result).not.toBeNull()
      expect(result?.expiry).toBeGreaterThan(Date.now())
    })
  })

  describe('complex tool data', () => {
    it('handles tools with complex schemas', async () => {
      const complexTool: McpTool = {
        name: 'complex-tool',
        description: 'A tool with complex schema',
        inputSchema: {
          type: 'object',
          properties: {
            config: {
              type: 'object',
              properties: {
                nested: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
          required: ['config'],
        },
        serverId: 'server-1',
        serverName: 'Test Server',
      }

      await cache.set('key-1', [complexTool], 60000)

      const result = await cache.get('key-1')

      expect(result?.tools[0]).toEqual(complexTool)
    })

    it('handles tools with special characters in names', async () => {
      const tools = [
        createTool('tool/with/slashes'),
        createTool('tool:with:colons'),
        createTool('tool.with.dots'),
      ]

      await cache.set('workspace:user-123', tools, 60000)

      const result = await cache.get('workspace:user-123')

      expect(result?.tools).toEqual(tools)
    })

    it('handles large number of tools', async () => {
      const tools: McpTool[] = []
      for (let i = 0; i < 100; i++) {
        tools.push(createTool(`tool-${i}`))
      }

      await cache.set('key-1', tools, 60000)

      const result = await cache.get('key-1')

      expect(result?.tools.length).toBe(100)
      expect(result?.tools[0].name).toBe('tool-0')
      expect(result?.tools[99].name).toBe('tool-99')
    })
  })

  describe('concurrent operations', () => {
    it('handles concurrent reads', async () => {
      const tools = [createTool('tool-1')]
      await cache.set('key-1', tools, 60000)

      const results = await Promise.all([
        cache.get('key-1'),
        cache.get('key-1'),
        cache.get('key-1'),
      ])

      results.forEach((result) => {
        expect(result).not.toBeNull()
        expect(result?.tools).toEqual(tools)
      })
    })

    it('handles concurrent writes to different keys', async () => {
      const tools = [createTool('tool')]

      await Promise.all([
        cache.set('key-1', tools, 60000),
        cache.set('key-2', tools, 60000),
        cache.set('key-3', tools, 60000),
      ])

      expect(await cache.get('key-1')).not.toBeNull()
      expect(await cache.get('key-2')).not.toBeNull()
      expect(await cache.get('key-3')).not.toBeNull()
    })

    it('handles read after immediate write', async () => {
      const tools = [createTool('tool-1')]

      // Write then immediately read
      await cache.set('key-1', tools, 60000)
      const result = await cache.get('key-1')

      expect(result).not.toBeNull()
      expect(result?.tools).toEqual(tools)
    })
  })
})
