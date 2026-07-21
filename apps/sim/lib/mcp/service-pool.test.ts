/**
 * @vitest-environment node
 *
 * Integration coverage for the connection-reuse wiring in `McpService`
 * (`withServerClient`): the pooled path leases without disconnecting and skips
 * env resolution on a hit, per-request headers bypass the pool, and a
 * dead-connection error poisons the lease. Pool internals are unit-tested in
 * `connection-pool.test.ts`.
 */
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockMcpClient,
  mockCallTool,
  mockConnect,
  mockDisconnect,
  mockAcquire,
  mockRelease,
  mockResolveEnvVars,
  mockCacheAdapter,
  poolClient,
} = vi.hoisted(() => {
  const mockCallTool = vi.fn()
  const mockConnect = vi.fn()
  const mockDisconnect = vi.fn()
  const mockRelease = vi.fn(async () => {})
  const poolClient = { callTool: mockCallTool, disconnect: vi.fn() }
  return {
    mockCallTool,
    mockConnect,
    mockDisconnect,
    mockRelease,
    poolClient,
    mockAcquire: vi.fn(async () => ({ client: poolClient, release: mockRelease })),
    mockResolveEnvVars: vi.fn(),
    mockCacheAdapter: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
      dispose: () => {},
    },
    MockMcpClient: vi.fn().mockImplementation(
      class {
        constructor() {
          Object.assign(this, {
            connect: mockConnect,
            disconnect: mockDisconnect,
            callTool: mockCallTool,
            listTools: vi.fn(async () => []),
            hasListChangedCapability: vi.fn(() => false),
            onClose: vi.fn(),
          })
        }
      }
    ),
  }
})

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@/lib/core/config/env-flags', () => ({ isTest: true }))
vi.mock('@/lib/mcp/connection-pool', () => ({
  mcpConnectionPool: { acquire: mockAcquire, evictServer: vi.fn() },
}))
vi.mock('@/lib/mcp/connection-manager', () => ({ mcpConnectionManager: null }))
vi.mock('@/lib/mcp/client', () => ({ McpClient: MockMcpClient }))

const WORKSPACE_ID = 'ws-1'
const USER_ID = 'user-1'

vi.mock('@sim/db', () => {
  const where = () => {
    const rows = Promise.resolve([
      {
        id: 'server-1',
        name: 'Server 1',
        description: null,
        transport: 'streamable-http',
        url: 'https://server-1.example.com/mcp',
        authType: 'headers',
        workspaceId: WORKSPACE_ID,
        headers: {},
        timeout: 30000,
        retries: 3,
        enabled: true,
        deletedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ])
    return Object.assign(rows, { limit: (n: number) => rows.then((r) => r.slice(0, n)) })
  }
  return {
    db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) },
  }
})
vi.mock('@/lib/mcp/domain-check', () => ({
  isMcpDomainAllowed: () => true,
  validateMcpDomain: () => {},
  validateMcpServerSsrf: async () => '203.0.113.10',
}))
vi.mock('@/lib/mcp/oauth', () => ({
  getOrCreateOauthRow: vi.fn(),
  loadPreregisteredClient: vi.fn(),
  SimMcpOauthProvider: vi.fn(),
  withMcpOauthRefreshLock: vi.fn(),
}))
vi.mock('@/lib/mcp/resolve-config', () => ({
  resolveMcpConfigEnvVars: (...args: unknown[]) => mockResolveEnvVars(...args),
}))
vi.mock('@/lib/mcp/storage', () => ({
  createMcpCacheAdapter: () => mockCacheAdapter,
  getMcpCacheType: () => 'memory',
}))

import { mcpService } from '@/lib/mcp/service'

describe('McpService connection reuse wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveEnvVars.mockImplementation(async (config: unknown) => ({ config }))
    mockAcquire.mockResolvedValue({ client: poolClient, release: mockRelease })
    mockCallTool.mockResolvedValue({ content: [] })
  })

  it('leases from the pool (keyed by server+workspace+user) and never disconnects on a hit', async () => {
    await mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID)

    expect(mockAcquire).toHaveBeenCalledTimes(1)
    expect(mockAcquire).toHaveBeenCalledWith(
      expect.objectContaining({ key: `server-1:${WORKSPACE_ID}:${USER_ID}`, serverId: 'server-1' })
    )
    expect(mockCallTool).toHaveBeenCalledTimes(1)
    expect(mockRelease).toHaveBeenCalledWith(false)
    expect(poolClient.disconnect).not.toHaveBeenCalled()
    // A pool hit must not re-resolve env vars (acquire never invoked `create`).
    expect(mockResolveEnvVars).not.toHaveBeenCalled()
  })

  it('bypasses the pool for calls carrying per-request headers', async () => {
    await mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID, {
      Authorization: 'Bearer per-call',
    })

    expect(mockAcquire).not.toHaveBeenCalled()
    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockDisconnect).toHaveBeenCalledTimes(1)
    expect(mockCallTool).toHaveBeenCalledTimes(1)
  })

  it('poisons the lease when the tool call hits a dead-connection error', async () => {
    mockCallTool.mockRejectedValue(new StreamableHTTPError(404, 'session gone'))

    await expect(
      mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID)
    ).rejects.toThrow()

    expect(mockRelease).toHaveBeenCalledWith(true)
  })

  it('keeps the pooled connection warm on a benign (non-connection) tool error', async () => {
    mockCallTool.mockRejectedValue(new Error('tool blew up'))

    await expect(
      mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID)
    ).rejects.toThrow()

    expect(mockRelease).toHaveBeenCalledWith(false)
  })

  it('poisons the lease on an auth failure so a rotated credential is re-resolved', async () => {
    mockCallTool.mockRejectedValue(new UnauthorizedError('token rejected'))

    await expect(
      mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID)
    ).rejects.toThrow()

    expect(mockRelease).toHaveBeenCalledWith(true)
  })

  it('retries and recovers when a rotated credential causes a one-off auth failure', async () => {
    mockCallTool
      .mockRejectedValueOnce(new UnauthorizedError('stale key'))
      .mockResolvedValueOnce({ content: [] })

    const result = await mcpService.executeTool(
      USER_ID,
      'server-1',
      { name: 'do', arguments: {} },
      WORKSPACE_ID
    )

    expect(result).toEqual({ content: [] })
    expect(mockCallTool).toHaveBeenCalledTimes(2)
    // First attempt poisoned the stale lease; the retry re-acquired a fresh one.
    expect(mockRelease).toHaveBeenCalledWith(true)
    expect(mockAcquire).toHaveBeenCalledTimes(2)
  })
})
