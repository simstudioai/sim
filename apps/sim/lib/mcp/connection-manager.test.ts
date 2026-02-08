/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface MockMcpClient {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  hasListChangedCapability: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
}

/** Deferred promise to control when `client.connect()` resolves. */
function createDeferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function serverConfig(id: string, name = `Server ${id}`) {
  return {
    id,
    name,
    transport: 'streamable-http' as const,
    url: `https://${id}.example.com/mcp`,
  }
}

/** Shared setup: resets modules and applies base mocks. */
function setupBaseMocks() {
  vi.resetModules()
  vi.doMock('@sim/logger', () => loggerMock)
  vi.doMock('@/lib/core/config/feature-flags', () => ({ isTest: false }))
  vi.doMock('@/lib/mcp/pubsub', () => ({
    mcpPubSub: { onToolsChanged: vi.fn(() => vi.fn()), publishToolsChanged: vi.fn() },
  }))
}

describe('McpConnectionManager', () => {
  let manager: { connect: Function; dispose: Function } | null = null

  afterEach(() => {
    manager?.dispose()
    manager = null
  })

  describe('concurrent connect() guard', () => {
    it('creates only one client when two connect() calls race for the same serverId', async () => {
      setupBaseMocks()

      const deferred = createDeferred()
      const instances: MockMcpClient[] = []

      vi.doMock('./client', () => ({
        McpClient: vi.fn().mockImplementation(() => {
          const instance: MockMcpClient = {
            connect: vi.fn().mockImplementation(() => deferred.promise),
            disconnect: vi.fn().mockResolvedValue(undefined),
            hasListChangedCapability: vi.fn().mockReturnValue(true),
            onClose: vi.fn(),
          }
          instances.push(instance)
          return instance
        }),
      }))

      const { mcpConnectionManager: mgr } = await import('./connection-manager')
      manager = mgr

      const config = serverConfig('server-1')

      // Fire two concurrent connect() calls for the same server
      const p1 = mgr.connect(config, 'user-1', 'ws-1')
      const p2 = mgr.connect(config, 'user-1', 'ws-1')

      deferred.resolve()
      const [r1, r2] = await Promise.all([p1, p2])

      // Only one McpClient should have been instantiated
      expect(instances).toHaveLength(1)
      expect(r1.supportsListChanged).toBe(true)
      // Second call hits the connectingServers guard and returns false
      expect(r2.supportsListChanged).toBe(false)
    })

    it('allows a new connect() after a previous one completes', async () => {
      setupBaseMocks()

      const instances: MockMcpClient[] = []

      vi.doMock('./client', () => ({
        McpClient: vi.fn().mockImplementation(() => {
          const instance: MockMcpClient = {
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            hasListChangedCapability: vi.fn().mockReturnValue(false),
            onClose: vi.fn(),
          }
          instances.push(instance)
          return instance
        }),
      }))

      const { mcpConnectionManager: mgr } = await import('./connection-manager')
      manager = mgr

      const config = serverConfig('server-2')

      // First connect — server doesn't support listChanged, disconnects immediately
      const r1 = await mgr.connect(config, 'user-1', 'ws-1')
      expect(r1.supportsListChanged).toBe(false)

      // connectingServers cleaned up via finally, so second connect proceeds
      const r2 = await mgr.connect(config, 'user-1', 'ws-1')
      expect(r2.supportsListChanged).toBe(false)

      expect(instances).toHaveLength(2)
    })

    it('cleans up connectingServers when connect() throws', async () => {
      setupBaseMocks()

      let callCount = 0
      const instances: MockMcpClient[] = []

      vi.doMock('./client', () => ({
        McpClient: vi.fn().mockImplementation(() => {
          callCount++
          const instance: MockMcpClient = {
            connect:
              callCount === 1
                ? vi.fn().mockRejectedValue(new Error('Connection refused'))
                : vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            hasListChangedCapability: vi.fn().mockReturnValue(true),
            onClose: vi.fn(),
          }
          instances.push(instance)
          return instance
        }),
      }))

      const { mcpConnectionManager: mgr } = await import('./connection-manager')
      manager = mgr

      const config = serverConfig('server-3')

      // First connect fails
      const r1 = await mgr.connect(config, 'user-1', 'ws-1')
      expect(r1.supportsListChanged).toBe(false)

      // Second connect should NOT be blocked by a stale connectingServers entry
      const r2 = await mgr.connect(config, 'user-1', 'ws-1')
      expect(r2.supportsListChanged).toBe(true)
      expect(instances).toHaveLength(2)
    })
  })

  describe('dispose', () => {
    it('rejects new connections after dispose', async () => {
      setupBaseMocks()

      vi.doMock('./client', () => ({
        McpClient: vi.fn().mockImplementation(() => ({
          connect: vi.fn().mockResolvedValue(undefined),
          disconnect: vi.fn().mockResolvedValue(undefined),
          hasListChangedCapability: vi.fn().mockReturnValue(true),
          onClose: vi.fn(),
        })),
      }))

      const { mcpConnectionManager: mgr } = await import('./connection-manager')
      manager = mgr

      mgr.dispose()

      const result = await mgr.connect(serverConfig('server-4'), 'user-1', 'ws-1')
      expect(result.supportsListChanged).toBe(false)
    })
  })
})
