/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const { MockMcpClientConstructor, mockOnToolsChanged, mockPublishToolsChanged } = vi.hoisted(
  () => ({
    MockMcpClientConstructor: vi.fn(),
    mockOnToolsChanged: vi.fn(() => vi.fn()),
    mockPublishToolsChanged: vi.fn(),
  })
)

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@/lib/core/config/feature-flags', () => ({ isTest: false }))
vi.mock('@/lib/mcp/pubsub', () => ({
  mcpPubSub: {
    onToolsChanged: mockOnToolsChanged,
    publishToolsChanged: mockPublishToolsChanged,
  },
}))
vi.mock('@/lib/mcp/client', () => ({
  McpClient: MockMcpClientConstructor,
}))

describe('McpConnectionManager', () => {
  let manager: {
    connect: (...args: unknown[]) => Promise<{ supportsListChanged: boolean }>
    dispose: () => void
  } | null = null

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    manager?.dispose()
    manager = null
  })

  /**
   * Because connection-manager.ts creates a singleton at module scope,
   * each test needs a fresh module evaluation.
   */
  async function importFreshManager() {
    vi.resetModules()
    const { mcpConnectionManager: mgr } = await import('@/lib/mcp/connection-manager')
    manager = mgr
    return mgr
  }

  describe('concurrent connect() guard', () => {
    it('creates only one client when two connect() calls race for the same serverId', async () => {
      const deferred = createDeferred()
      const instances: MockMcpClient[] = []

      MockMcpClientConstructor.mockImplementation(() => {
        const instance: MockMcpClient = {
          connect: vi.fn().mockImplementation(() => deferred.promise),
          disconnect: vi.fn().mockResolvedValue(undefined),
          hasListChangedCapability: vi.fn().mockReturnValue(true),
          onClose: vi.fn(),
        }
        instances.push(instance)
        return instance
      })

      const mgr = await importFreshManager()

      const config = serverConfig('server-1')

      const p1 = mgr.connect(config, 'user-1', 'ws-1')
      const p2 = mgr.connect(config, 'user-1', 'ws-1')

      deferred.resolve()
      const [r1, r2] = await Promise.all([p1, p2])

      expect(instances).toHaveLength(1)
      expect(r1.supportsListChanged).toBe(true)
      expect(r2.supportsListChanged).toBe(false)
    })

    it('allows a new connect() after a previous one completes', async () => {
      const instances: MockMcpClient[] = []

      MockMcpClientConstructor.mockImplementation(() => {
        const instance: MockMcpClient = {
          connect: vi.fn().mockResolvedValue(undefined),
          disconnect: vi.fn().mockResolvedValue(undefined),
          hasListChangedCapability: vi.fn().mockReturnValue(false),
          onClose: vi.fn(),
        }
        instances.push(instance)
        return instance
      })

      const mgr = await importFreshManager()

      const config = serverConfig('server-2')

      const r1 = await mgr.connect(config, 'user-1', 'ws-1')
      expect(r1.supportsListChanged).toBe(false)

      const r2 = await mgr.connect(config, 'user-1', 'ws-1')
      expect(r2.supportsListChanged).toBe(false)

      expect(instances).toHaveLength(2)
    })

    it('cleans up connectingServers when connect() throws', async () => {
      let callCount = 0
      const instances: MockMcpClient[] = []

      MockMcpClientConstructor.mockImplementation(() => {
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
      })

      const mgr = await importFreshManager()

      const config = serverConfig('server-3')

      const r1 = await mgr.connect(config, 'user-1', 'ws-1')
      expect(r1.supportsListChanged).toBe(false)

      const r2 = await mgr.connect(config, 'user-1', 'ws-1')
      expect(r2.supportsListChanged).toBe(true)
      expect(instances).toHaveLength(2)
    })
  })

  describe('dispose', () => {
    it('rejects new connections after dispose', async () => {
      MockMcpClientConstructor.mockImplementation(() => ({
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        hasListChangedCapability: vi.fn().mockReturnValue(true),
        onClose: vi.fn(),
      }))

      const mgr = await importFreshManager()

      mgr.dispose()

      const result = await mgr.connect(serverConfig('server-4'), 'user-1', 'ws-1')
      expect(result.supportsListChanged).toBe(false)
    })
  })
})
