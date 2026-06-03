/**
 * @vitest-environment node
 */
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

const {
  MockMcpClientConstructor,
  mockOnToolsChanged,
  mockPublishToolsChanged,
  mockGetOrCreateOauthRow,
} = vi.hoisted(() => ({
  MockMcpClientConstructor: vi.fn(),
  mockOnToolsChanged: vi.fn(() => vi.fn()),
  mockPublishToolsChanged: vi.fn(),
  mockGetOrCreateOauthRow: vi.fn(),
}))

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
vi.mock('@/lib/mcp/oauth', () => ({
  getOrCreateOauthRow: mockGetOrCreateOauthRow,
  loadPreregisteredClient: vi.fn(),
  SimMcpOauthProvider: vi.fn().mockImplementation(
    class {
      constructor(value: object) {
        Object.assign(this, value)
      }
    }
  ),
}))

import { McpConnectionManager } from '@/lib/mcp/connection-manager'

describe('McpConnectionManager', () => {
  let manager: McpConnectionManager | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOrCreateOauthRow.mockResolvedValue({
      id: 'oauth-row-1',
      mcpServerId: 'server-oauth',
      userId: 'authorizer-1',
      workspaceId: 'ws-1',
      clientInformation: null,
      tokens: { access_token: 'workspace-token', token_type: 'Bearer' },
      codeVerifier: null,
      state: null,
      updatedAt: new Date(),
    })
  })

  afterEach(() => {
    manager?.dispose()
    manager = null
    vi.useRealTimers()
  })

  function createFreshManager(): McpConnectionManager {
    const mgr = new McpConnectionManager()
    manager = mgr
    return mgr
  }

  describe('concurrent connect() guard', () => {
    it('creates only one client when two connect() calls race for the same serverId', async () => {
      const deferred = createDeferred()
      const instances: MockMcpClient[] = []

      MockMcpClientConstructor.mockImplementation(
        class {
          constructor() {
            const instance: MockMcpClient = {
              connect: vi.fn().mockImplementation(() => deferred.promise),
              disconnect: vi.fn().mockResolvedValue(undefined),
              hasListChangedCapability: vi.fn().mockReturnValue(true),
              onClose: vi.fn(),
            }
            instances.push(instance)
            Object.assign(this, instance)
          }
        }
      )

      const mgr = createFreshManager()

      const config = serverConfig('server-1')

      const p1 = mgr.connect(config, 'user-1', 'ws-1')
      const p2 = mgr.connect(config, 'user-1', 'ws-1')

      deferred.resolve()
      const [r1, r2] = await Promise.all([p1, p2])

      expect(instances).toHaveLength(1)
      expect(r1.supportsListChanged).toBe(true)
      expect(r2.supportsListChanged).toBe(false)
    })

    it('shares OAuth managed connections across workspace users for the same server', async () => {
      const instances: MockMcpClient[] = []

      MockMcpClientConstructor.mockImplementation(
        class {
          constructor() {
            const instance: MockMcpClient = {
              connect: vi.fn().mockResolvedValue(undefined),
              disconnect: vi.fn().mockResolvedValue(undefined),
              hasListChangedCapability: vi.fn().mockReturnValue(true),
              onClose: vi.fn(),
            }
            instances.push(instance)
            Object.assign(this, instance)
          }
        }
      )

      const mgr = createFreshManager()
      const config = { ...serverConfig('server-oauth'), authType: 'oauth' as const }

      const r1 = await mgr.connect(config, 'user-1', 'ws-1')
      const r2 = await mgr.connect(config, 'user-2', 'ws-1')

      expect(instances).toHaveLength(1)
      expect(r1.supportsListChanged).toBe(true)
      expect(r2.supportsListChanged).toBe(true)
      expect(mockGetOrCreateOauthRow).toHaveBeenCalledTimes(1)
      expect(mockGetOrCreateOauthRow).toHaveBeenCalledWith({
        mcpServerId: 'server-oauth',
        userId: 'user-1',
        workspaceId: 'ws-1',
      })
    })

    it('allows a new connect() after a previous one completes', async () => {
      const instances: MockMcpClient[] = []

      MockMcpClientConstructor.mockImplementation(
        class {
          constructor() {
            const instance: MockMcpClient = {
              connect: vi.fn().mockResolvedValue(undefined),
              disconnect: vi.fn().mockResolvedValue(undefined),
              hasListChangedCapability: vi.fn().mockReturnValue(false),
              onClose: vi.fn(),
            }
            instances.push(instance)
            Object.assign(this, instance)
          }
        }
      )

      const mgr = createFreshManager()

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

      MockMcpClientConstructor.mockImplementation(
        class {
          constructor() {
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
            Object.assign(this, instance)
          }
        }
      )

      const mgr = createFreshManager()

      const config = serverConfig('server-3')

      const r1 = await mgr.connect(config, 'user-1', 'ws-1')
      expect(r1.supportsListChanged).toBe(false)

      const r2 = await mgr.connect(config, 'user-1', 'ws-1')
      expect(r2.supportsListChanged).toBe(true)
      expect(instances).toHaveLength(2)
    })

    it('marks timed-out connect attempts as cancelled for late completions', async () => {
      vi.useFakeTimers()
      const deferred = createDeferred()
      const instances: MockMcpClient[] = []

      MockMcpClientConstructor.mockImplementation(
        class {
          constructor() {
            const instance: MockMcpClient = {
              connect: vi.fn().mockImplementation(() => deferred.promise),
              disconnect: vi.fn().mockResolvedValue(undefined),
              hasListChangedCapability: vi.fn().mockReturnValue(true),
              onClose: vi.fn(),
            }
            instances.push(instance)
            Object.assign(this, instance)
          }
        }
      )

      const mgr = createFreshManager()
      const resultPromise = mgr.connect(serverConfig('server-timeout'), 'user-1', 'ws-1')

      await vi.advanceTimersByTimeAsync(15_000)
      const result = await resultPromise
      const connectOptions = instances[0].connect.mock.calls[0][0]

      expect(result.supportsListChanged).toBe(false)
      expect(connectOptions.isCancelled()).toBe(true)
      expect(instances[0].disconnect).toHaveBeenCalled()

      deferred.resolve()
    })
  })

  describe('dispose', () => {
    it('rejects new connections after dispose', async () => {
      MockMcpClientConstructor.mockImplementation(
        class {
          constructor() {
            Object.assign(this, {
              connect: vi.fn().mockResolvedValue(undefined),
              disconnect: vi.fn().mockResolvedValue(undefined),
              hasListChangedCapability: vi.fn().mockReturnValue(true),
              onClose: vi.fn(),
            })
          }
        }
      )

      const mgr = createFreshManager()

      mgr.dispose()

      const result = await mgr.connect(serverConfig('server-4'), 'user-1', 'ws-1')
      expect(result.supportsListChanged).toBe(false)
    })
  })

  describe('intentional disconnect cleanup', () => {
    it('does not reconnect when disconnectServer closes a managed client', async () => {
      vi.useFakeTimers()
      let closeHandler: (() => void) | undefined
      const instances: MockMcpClient[] = []

      MockMcpClientConstructor.mockImplementation(
        class {
          constructor() {
            const instance: MockMcpClient = {
              connect: vi.fn().mockResolvedValue(undefined),
              disconnect: vi.fn().mockImplementation(async () => {
                closeHandler?.()
              }),
              hasListChangedCapability: vi.fn().mockReturnValue(true),
              onClose: vi.fn().mockImplementation((handler: () => void) => {
                closeHandler = handler
              }),
            }
            instances.push(instance)
            Object.assign(this, instance)
          }
        }
      )

      const mgr = createFreshManager()
      await mgr.connect(serverConfig('server-5'), 'user-1', 'ws-1')

      await mgr.disconnectServer('server-5')
      await vi.advanceTimersByTimeAsync(2_000)

      expect(instances).toHaveLength(1)
      expect(mgr.hasConnection('server-5')).toBe(false)
    })

    it('does not reconnect when close fires after disconnect resolves', async () => {
      vi.useFakeTimers()
      let closeHandler: (() => void) | undefined
      const instances: MockMcpClient[] = []

      MockMcpClientConstructor.mockImplementation(
        class {
          constructor() {
            const instance: MockMcpClient = {
              connect: vi.fn().mockResolvedValue(undefined),
              disconnect: vi.fn().mockResolvedValue(undefined),
              hasListChangedCapability: vi.fn().mockReturnValue(true),
              onClose: vi.fn().mockImplementation((handler: () => void) => {
                closeHandler = handler
              }),
            }
            instances.push(instance)
            Object.assign(this, instance)
          }
        }
      )

      const mgr = createFreshManager()
      await mgr.connect(serverConfig('server-7'), 'user-1', 'ws-1')

      await mgr.disconnectServer('server-7')
      closeHandler?.()
      await vi.advanceTimersByTimeAsync(2_000)

      expect(instances).toHaveLength(1)
      expect(mgr.hasConnection('server-7')).toBe(false)
    })

    it('does not reconnect idle connections after cleanup disconnects them', async () => {
      vi.useFakeTimers()
      const closeHandlers: Array<() => void> = []
      const instances: MockMcpClient[] = []

      MockMcpClientConstructor.mockImplementation(
        class {
          constructor() {
            const instance: MockMcpClient = {
              connect: vi.fn().mockResolvedValue(undefined),
              disconnect: vi.fn().mockImplementation(async () => {
                closeHandlers.at(-1)?.()
              }),
              hasListChangedCapability: vi.fn().mockReturnValue(true),
              onClose: vi.fn().mockImplementation((handler: () => void) => {
                closeHandlers.push(handler)
              }),
            }
            instances.push(instance)
            Object.assign(this, instance)
          }
        }
      )

      const mgr = createFreshManager()
      await mgr.connect(serverConfig('server-6'), 'user-1', 'ws-1')

      await vi.advanceTimersByTimeAsync(35 * 60 * 1000)

      expect(instances).toHaveLength(1)
      expect(mgr.hasConnection('server-6')).toBe(false)
    })
  })
})
