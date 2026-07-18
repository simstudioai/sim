/**
 * @vitest-environment node
 *
 * Integration coverage for the connection-reuse wiring in `McpService`
 * (`withServerClient`): the pooled path reuses without disconnecting, per-request
 * headers bypass the pool, and a failed operation evicts the pooled connection.
 * The pool's own behavior is unit-tested in `connection-pool.test.ts`.
 */
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockMcpClient,
  mockCallTool,
  mockConnect,
  mockDisconnect,
  mockAcquire,
  mockEvict,
  mockResolveEnvVars,
  mockCacheAdapter,
  poolClient,
} = vi.hoisted(() => {
  const mockCallTool = vi.fn()
  const mockConnect = vi.fn()
  const mockDisconnect = vi.fn()
  const poolClient = { callTool: mockCallTool, disconnect: vi.fn() }
  const cacheStore = new Map<string, unknown>()
  return {
    mockCallTool,
    mockConnect,
    mockDisconnect,
    poolClient,
    mockAcquire: vi.fn(async () => poolClient),
    mockEvict: vi.fn(async () => {}),
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
    __cacheStore: cacheStore,
  }
})

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@/lib/core/config/env-flags', () => ({ isTest: true }))
vi.mock('@/lib/mcp/connection-pool', () => ({
  mcpConnectionPool: { acquire: mockAcquire, evict: mockEvict },
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
    mockAcquire.mockResolvedValue(poolClient)
    mockCallTool.mockResolvedValue({ content: [] })
  })

  it('executes a tool through the pool without disconnecting the reused connection', async () => {
    await mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID)

    expect(mockAcquire).toHaveBeenCalledTimes(1)
    expect(mockAcquire).toHaveBeenCalledWith(expect.objectContaining({ key: 'server-1' }))
    expect(mockCallTool).toHaveBeenCalledTimes(1)
    // Pooled connection is returned to the pool, never disconnected here.
    expect(poolClient.disconnect).not.toHaveBeenCalled()
    expect(mockDisconnect).not.toHaveBeenCalled()
  })

  it('bypasses the pool for calls carrying per-request headers', async () => {
    await mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID, {
      Authorization: 'Bearer per-call',
    })

    // extraHeaders → ephemeral connect-per-op, not the shared pool.
    expect(mockAcquire).not.toHaveBeenCalled()
    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockDisconnect).toHaveBeenCalledTimes(1)
    expect(mockCallTool).toHaveBeenCalledTimes(1)
  })

  it('evicts the pooled connection when the tool call fails', async () => {
    mockCallTool.mockRejectedValue(new StreamableHTTPError(404, 'session gone'))

    await expect(
      mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID)
    ).rejects.toThrow()

    expect(mockEvict).toHaveBeenCalledWith('server-1', expect.any(String))
  })
})
