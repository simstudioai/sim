/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockMcpClient,
  mockListTools,
  mockConnect,
  mockDisconnect,
  mockGetWorkspaceServersRows,
  mockResolveEnvVars,
  mockValidateDomain,
  mockValidateSsrf,
  mockIsDomainAllowed,
  mockCacheAdapter,
  mockUpdateSet,
  mockUpdateReturning,
} = vi.hoisted(() => {
  const mockListTools = vi.fn()
  const mockConnect = vi.fn()
  const mockDisconnect = vi.fn()
  const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: 'server-1' }])
  // In-memory cache adapter so the service never touches the real Redis the
  // local .env points at (unreachable in CI/sandbox → hangs). Honors TTL via
  // an expiry timestamp so negative-cache assertions behave like production.
  const cacheStore = new Map<string, { tools: unknown[]; expiry: number }>()
  const mockCacheAdapter = {
    get: async (key: string) => {
      const entry = cacheStore.get(key)
      if (!entry) return null
      if (entry.expiry <= Date.now()) {
        cacheStore.delete(key)
        return null
      }
      return entry
    },
    set: async (key: string, tools: unknown[], ttlMs: number) => {
      cacheStore.set(key, { tools, expiry: Date.now() + ttlMs })
    },
    delete: async (key: string) => {
      cacheStore.delete(key)
    },
    clear: async () => {
      cacheStore.clear()
    },
    dispose: () => {},
  }
  return {
    mockCacheAdapter,
    MockMcpClient: vi.fn().mockImplementation(
      class {
        constructor() {
          Object.assign(this, {
            connect: mockConnect,
            disconnect: mockDisconnect,
            listTools: mockListTools,
            hasListChangedCapability: vi.fn(() => false),
            onClose: vi.fn(),
            getNegotiatedVersion: vi.fn(() => '2025-06-18'),
          })
        }
      }
    ),
    mockListTools,
    mockConnect,
    mockDisconnect,
    mockGetWorkspaceServersRows: vi.fn(),
    mockResolveEnvVars: vi.fn(),
    mockValidateDomain: vi.fn(),
    mockValidateSsrf: vi.fn(),
    mockIsDomainAllowed: vi.fn(() => true),
    mockUpdateReturning,
    mockUpdateSet: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: mockUpdateReturning }),
    }),
  }
})

vi.mock('@sim/db', () => {
  // `where(...)` resolves to the workspace's rows AND exposes `.limit()` for
  // chains like `getServerConfig` that do `select().from().where().limit(1)`.
  const where = (...args: unknown[]) => {
    const rowsPromise = Promise.resolve(mockGetWorkspaceServersRows(...args))
    const thenable = Object.assign(rowsPromise, {
      limit: (n: number) => rowsPromise.then((rows) => rows.slice(0, n)),
    })
    return thenable
  }
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where }),
      }),
      update: vi.fn().mockReturnValue({ set: mockUpdateSet }),
      insert: vi.fn(),
      delete: vi.fn(),
    },
  }
})

vi.mock('@/lib/mcp/client', () => ({
  McpClient: MockMcpClient,
}))

vi.mock('@/lib/mcp/connection-manager', () => ({
  mcpConnectionManager: null,
}))

vi.mock('@/lib/mcp/domain-check', () => ({
  isMcpDomainAllowed: (...args: unknown[]) => mockIsDomainAllowed(...args),
  validateMcpDomain: (...args: unknown[]) => mockValidateDomain(...args),
  validateMcpServerSsrf: (...args: unknown[]) => mockValidateSsrf(...args),
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
import { McpOauthAuthorizationRequiredError } from '@/lib/mcp/types'

const WORKSPACE_ID = 'workspace-test'
const USER_ID = 'user-test'

function dbRow(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    description: null,
    transport: 'streamable-http',
    url: `https://${id}.example.com/mcp`,
    authType: 'headers',
    workspaceId: WORKSPACE_ID,
    headers: {},
    timeout: 30000,
    retries: 3,
    enabled: true,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function tool(name: string, serverId: string) {
  return {
    name,
    description: name,
    inputSchema: { type: 'object' },
    serverId,
    serverName: serverId,
  }
}

describe('McpService.discoverTools per-server caching', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // `clearAllMocks` does not drain `.mockResolvedValueOnce` queues; reset
    // listTools so a previous test's unconsumed mock doesn't leak into the next.
    mockListTools.mockReset()
    mockIsDomainAllowed.mockReturnValue(true)
    mockValidateSsrf.mockResolvedValue('1.2.3.4')
    mockValidateDomain.mockImplementation(() => undefined)
    mockResolveEnvVars.mockImplementation((config: { url: string }) =>
      Promise.resolve({ config: { ...config, url: config.url }, missingVars: [] })
    )
    mockConnect.mockResolvedValue(undefined)
    mockDisconnect.mockResolvedValue(undefined)
    mockUpdateReturning.mockReset()
    mockUpdateReturning.mockResolvedValue([{ id: 'server-1' }])
    // The McpService singleton holds cache state across imports.
    await mcpService.clearCache()
  })

  it('caches each server independently after first discovery', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A'), dbRow('mcp-b', 'B')])
    mockListTools
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])
      .mockResolvedValueOnce([tool('b1', 'mcp-b')])

    const first = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(first.map((t) => t.name).sort()).toEqual(['a1', 'b1'])
    expect(mockListTools).toHaveBeenCalledTimes(2)

    mockListTools.mockClear()
    const second = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(second.map((t) => t.name).sort()).toEqual(['a1', 'b1'])
    expect(mockListTools).not.toHaveBeenCalled()
  })

  it("one server failing does not poison another server's cache", async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A'), dbRow('mcp-b', 'B')])
    mockListTools
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])
      .mockRejectedValueOnce(new Error('Request timed out'))

    const first = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(first.map((t) => t.name)).toEqual(['a1'])

    mockListTools.mockClear()

    // a1's positive cache is intact (the failure didn't poison it). b is now
    // negative-cached so it's skipped instead of re-blocking — see
    // "negative-caches a failed server so the next discoverTools skips it"
    // below for the full assertion.
    const second = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(second.map((t) => t.name)).toEqual(['a1'])
    expect(mockListTools).not.toHaveBeenCalled()
  })

  it("forceRefresh bypasses every server's cache", async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A'), dbRow('mcp-b', 'B')])
    mockListTools
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])
      .mockResolvedValueOnce([tool('b1', 'mcp-b')])

    await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(mockListTools).toHaveBeenCalledTimes(2)

    mockListTools.mockClear()
    mockListTools
      .mockResolvedValueOnce([tool('a2', 'mcp-a')])
      .mockResolvedValueOnce([tool('b2', 'mcp-b')])

    const refreshed = await mcpService.discoverTools(USER_ID, WORKSPACE_ID, true)
    expect(refreshed.map((t) => t.name).sort()).toEqual(['a2', 'b2'])
    expect(mockListTools).toHaveBeenCalledTimes(2)
  })

  it('OAuth-pending is treated as a soft skip without poisoning cache', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A'), dbRow('mcp-b', 'B')])
    mockListTools
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])
      .mockRejectedValueOnce(new McpOauthAuthorizationRequiredError('mcp-b', 'B'))

    const first = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(first.map((t) => t.name)).toEqual(['a1'])

    mockListTools.mockClear()
    mockListTools.mockRejectedValueOnce(new McpOauthAuthorizationRequiredError('mcp-b', 'B'))

    await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(mockListTools).toHaveBeenCalledTimes(1)
  })

  it('returns empty array immediately when workspace has no servers', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([])

    const result = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(result).toEqual([])
    expect(mockListTools).not.toHaveBeenCalled()
    expect(MockMcpClient).not.toHaveBeenCalled()
  })

  it('clearCache(workspaceId) drops cached tools so next call re-fetches', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])

    await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(mockListTools).toHaveBeenCalledTimes(1)

    await mcpService.clearCache(WORKSPACE_ID)

    mockListTools.mockClear()
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])
    await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(mockListTools).toHaveBeenCalledTimes(1)
  })

  it('isolates caches across workspaces', async () => {
    const otherWorkspaceId = 'workspace-other'
    mockGetWorkspaceServersRows
      .mockResolvedValueOnce([dbRow('mcp-a', 'A')])
      .mockResolvedValueOnce([dbRow('mcp-a', 'A', { workspaceId: otherWorkspaceId })])

    mockListTools
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])
      .mockResolvedValueOnce([tool('a-other', 'mcp-a')])

    const first = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    const second = await mcpService.discoverTools(USER_ID, otherWorkspaceId)

    expect(first.map((t) => t.name)).toEqual(['a1'])
    expect(second.map((t) => t.name)).toEqual(['a-other'])
    expect(mockListTools).toHaveBeenCalledTimes(2)
  })

  it('discoverServerTools primes the per-server cache for follow-up discoverTools', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])

    const tools = await mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)
    expect(tools.map((t) => t.name)).toEqual(['a1'])
    expect(mockListTools).toHaveBeenCalledTimes(1)

    mockListTools.mockClear()
    const second = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(second.map((t) => t.name)).toEqual(['a1'])
    expect(mockListTools).not.toHaveBeenCalled()
  })

  it('negative-caches a failed server so the next discoverTools skips it', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A'), dbRow('mcp-b', 'B')])
    mockListTools
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])
      .mockRejectedValueOnce(new Error('Request timed out'))

    await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(mockListTools).toHaveBeenCalledTimes(2)

    mockListTools.mockClear()
    // Second call: a1 is success-cached, b is failure-cached. Neither should
    // hit the live transport — the slow server no longer blocks the response.
    const second = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(second.map((t) => t.name)).toEqual(['a1'])
    expect(mockListTools).not.toHaveBeenCalled()
  })

  it('successful discoverServerTools clears the negative cache', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools.mockRejectedValueOnce(new Error('Request timed out'))

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'Request timed out'
    )

    // After the failure the negative cache is set, so the next default call
    // short-circuits without re-paying the listTools timeout.
    mockListTools.mockClear()
    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'cooldown'
    )
    expect(mockListTools).not.toHaveBeenCalled()

    // Reconnecting via the explicit-refresh path (refresh button / OAuth
    // callback) bypasses both caches and brings the server back to live.
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])
    const tools = await mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, true)
    expect(tools.map((t) => t.name)).toEqual(['a1'])

    // discoverTools now sees the cleared negative cache + primed positive cache.
    mockListTools.mockClear()
    const after = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(after.map((t) => t.name)).toEqual(['a1'])
    expect(mockListTools).not.toHaveBeenCalled()
  })

  it('does not negative-cache OAuth-required errors', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools.mockRejectedValueOnce(new McpOauthAuthorizationRequiredError('mcp-a', 'A'))

    await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(mockListTools).toHaveBeenCalledTimes(1)

    // Second call must still attempt the live transport — OAuth re-auth has
    // its own pathway and a stale negative cache would make reconnects
    // silently fail until the TTL expired.
    mockListTools.mockClear()
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])
    const after = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(after.map((t) => t.name)).toEqual(['a1'])
    expect(mockListTools).toHaveBeenCalledTimes(1)
  })

  it('persists a per-server discovery failure before rethrowing it', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([
      dbRow('mcp-a', 'A', {
        statusConfig: { consecutiveFailures: 0, lastSuccessfulDiscovery: null },
      }),
    ])
    mockListTools.mockRejectedValueOnce(new Error('Request timed out'))

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'Request timed out'
    )

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionStatus: 'disconnected',
        lastError: 'Request timed out',
        statusConfig: { consecutiveFailures: 1, lastSuccessfulDiscovery: null },
      })
    )
  })

  it('promotes the persisted server status to error on the third consecutive failure', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([
      dbRow('mcp-a', 'A', {
        statusConfig: { consecutiveFailures: 2, lastSuccessfulDiscovery: null },
      }),
    ])
    mockListTools.mockRejectedValueOnce(new Error('Connection refused'))

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'Connection refused'
    )

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionStatus: 'error',
        statusConfig: { consecutiveFailures: 3, lastSuccessfulDiscovery: null },
      })
    )
  })

  it('persists OAuth-required discovery as disconnected without a failure error', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools.mockRejectedValueOnce(new McpOauthAuthorizationRequiredError('mcp-a', 'A'))

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'OAuth authorization required'
    )

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionStatus: 'disconnected',
        lastError: null,
      })
    )
  })

  it('does not negative-cache a failure older than a successful discovery', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools.mockRejectedValueOnce(new Error('Older request failed'))
    mockUpdateReturning.mockResolvedValueOnce([])

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'Older request failed'
    )

    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])
    const tools = await mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)

    expect(tools.map((tool) => tool.name)).toEqual(['a1'])
    expect(mockListTools).toHaveBeenCalledTimes(2)
  })
})
