/**
 * @vitest-environment node
 */

import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { loggerMock } from '@sim/testing'
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
  cacheStore,
} = vi.hoisted(() => {
  const mockListTools = vi.fn()
  const mockConnect = vi.fn()
  const mockDisconnect = vi.fn()
  const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: 'server-1' }])
  // In-memory cache adapter so the service never touches the real Redis the
  // local .env points at (unreachable in CI/sandbox → hangs). Honors TTL via
  // an expiry timestamp so negative-cache assertions behave like production.
  const cacheStore = new Map<string, { tools: unknown[]; expiry: number }>()
  const cacheMutations = new Map<string, number>()
  let nextMutationId = 0
  const mockCacheAdapter = {
    get: vi.fn(async (key: string) => {
      const entry = cacheStore.get(key)
      if (!entry) return null
      if (entry.expiry <= Date.now()) {
        cacheStore.delete(key)
        return null
      }
      return entry
    }),
    set: vi.fn(async (key: string, tools: unknown[], ttlMs: number) => {
      cacheStore.set(key, { tools, expiry: Date.now() + ttlMs })
    }),
    delete: vi.fn(async (key: string) => {
      cacheStore.delete(key)
    }),
    beginMutation: vi.fn(async (scopeKey: string) => {
      const mutationId = Math.max(nextMutationId + 1, Date.now())
      nextMutationId = mutationId
      cacheMutations.set(scopeKey, mutationId)
      return mutationId
    }),
    setIfCurrentMutation: vi.fn(
      async (
        scopeKey: string,
        mutationId: number,
        key: string,
        tools: unknown[],
        ttlMs: number
      ) => {
        if (cacheMutations.get(scopeKey) !== mutationId) return false
        cacheStore.set(key, { tools, expiry: Date.now() + ttlMs })
        return true
      }
    ),
    deleteIfCurrentMutation: vi.fn(async (scopeKey: string, mutationId: number, key: string) => {
      if (cacheMutations.get(scopeKey) !== mutationId) return false
      cacheStore.delete(key)
      return true
    }),
    applyMutationIfCurrent: vi.fn(
      async (
        scopeKey: string,
        mutationId: number,
        setEntry: { key: string; tools: unknown[]; ttlMs: number } | null,
        deleteKeys: string[]
      ) => {
        if (cacheMutations.get(scopeKey) !== mutationId) return false
        if (setEntry) {
          cacheStore.set(setEntry.key, {
            tools: setEntry.tools,
            expiry: Date.now() + setEntry.ttlMs,
          })
        }
        for (const key of deleteKeys) cacheStore.delete(key)
        return true
      }
    ),
    clear: vi.fn(async () => {
      for (const scopeKey of cacheMutations.keys()) {
        const mutationId = Math.max(nextMutationId + 1, Date.now())
        nextMutationId = mutationId
        cacheMutations.set(scopeKey, mutationId)
      }
      cacheStore.clear()
    }),
    dispose: () => {},
  }
  return {
    cacheStore,
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

import { getTimestampMillisecondBounds, mcpService } from '@/lib/mcp/service'
import { McpOauthAuthorizationRequiredError } from '@/lib/mcp/types'

const mockLogger = vi.mocked(loggerMock.createLogger).mock.results.at(-1)?.value

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

describe('getTimestampMillisecondBounds', () => {
  it('includes PostgreSQL sub-millisecond precision but excludes the next millisecond', () => {
    const { startInclusive, endExclusive } = getTimestampMillisecondBounds(
      '2026-01-01T00:00:00.123Z'
    )
    const startMicroseconds = startInclusive.getTime() * 1_000
    const endMicroseconds = endExclusive.getTime() * 1_000
    const isWithinBounds = (candidateMicroseconds: number) =>
      candidateMicroseconds >= startMicroseconds && candidateMicroseconds < endMicroseconds

    // PostgreSQL can retain any of these extra microseconds even though the
    // JavaScript Date used as the generation token is truncated to .123.
    expect(isWithinBounds(startMicroseconds + 999)).toBe(true)
    expect(isWithinBounds(endMicroseconds)).toBe(false)
  })
})

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

  it('persists and negative-caches UnauthorizedError for a headers-auth server', async () => {
    const reflectedCredential = 'Bearer static-secret-for-bulk-discovery'
    mockGetWorkspaceServersRows.mockResolvedValue([
      dbRow('mcp-a', 'A', {
        statusConfig: { consecutiveFailures: 0, lastSuccessfulDiscovery: null },
      }),
    ])
    mockConnect.mockRejectedValueOnce(
      new UnauthorizedError(`Rejected Authorization: ${reflectedCredential}`)
    )

    const first = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(first).toEqual([])

    await vi.waitFor(() => {
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionStatus: 'disconnected',
          lastError: 'Authentication failed',
          statusConfig: { consecutiveFailures: 1, lastSuccessfulDiscovery: null },
        })
      )
      expect(mockCacheAdapter.applyMutationIfCurrent).toHaveBeenCalledWith(
        `workspace:${WORKSPACE_ID}:server:mcp-a`,
        expect.any(Number),
        {
          key: `workspace:${WORKSPACE_ID}:server:mcp-a:failure`,
          tools: [],
          ttlMs: expect.any(Number),
        },
        [`workspace:${WORKSPACE_ID}:server:mcp-a`]
      )
    })
    expect(JSON.stringify(mockUpdateSet.mock.calls)).not.toContain(reflectedCredential)
    expect(JSON.stringify(mockCacheAdapter.applyMutationIfCurrent.mock.calls)).not.toContain(
      reflectedCredential
    )
    expect(JSON.stringify(mockLogger?.warn.mock.calls)).not.toContain(reflectedCredential)
    expect(mockListTools).not.toHaveBeenCalled()

    mockListTools.mockClear()
    const second = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(second).toEqual([])
    expect(mockListTools).not.toHaveBeenCalled()
  })

  it('keeps UnauthorizedError soft-pending for an OAuth server', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A', { authType: 'oauth' })])
    mockResolveEnvVars.mockRejectedValue(new UnauthorizedError('OAuth token rejected'))

    const first = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(first).toEqual([])

    await vi.waitFor(() => {
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionStatus: 'disconnected',
          lastError: null,
        })
      )
    })
    expect(mockCacheAdapter.applyMutationIfCurrent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ key: `workspace:${WORKSPACE_ID}:server:mcp-a:failure` }),
      expect.anything()
    )

    mockResolveEnvVars.mockClear()
    await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(mockResolveEnvVars).toHaveBeenCalledTimes(1)
  })

  it('successful discoverServerTools clears the negative cache', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    // A timeout is transient/retryable, so it must fail every attempt to reach
    // the persisted-failure path.
    mockListTools
      .mockRejectedValueOnce(new Error('Request timed out'))
      .mockRejectedValueOnce(new Error('Request timed out'))

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

  it('retries mutation ownership before publishing discovery state', async () => {
    const serverKey = `workspace:${WORKSPACE_ID}:server:mcp-a`
    const failureKey = `${serverKey}:failure`
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    cacheStore.set(failureKey, { tools: [], expiry: Date.now() + 60_000 })
    mockCacheAdapter.beginMutation.mockRejectedValueOnce(new Error('cache ordering unavailable'))
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])

    const tools = await mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, true)

    expect(tools).toEqual([tool('a1', 'mcp-a')])
    expect(cacheStore.get(serverKey)?.tools).toEqual([tool('a1', 'mcp-a')])
    expect(cacheStore.has(failureKey)).toBe(false)
    expect(mockCacheAdapter.beginMutation).toHaveBeenCalledTimes(2)
    expect(mockCacheAdapter.applyMutationIfCurrent).toHaveBeenCalledWith(
      serverKey,
      expect.any(Number),
      { key: serverKey, tools: [tool('a1', 'mcp-a')], ttlMs: expect.any(Number) },
      [failureKey]
    )
    expect(mockCacheAdapter.set).not.toHaveBeenCalled()
    expect(mockCacheAdapter.delete).not.toHaveBeenCalled()
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ connectionStatus: 'connected', toolCount: 1 })
    )
  })

  it('keeps an older ordered publisher from superseding a retry-acquired mutation', async () => {
    const serverKey = `workspace:${WORKSPACE_ID}:server:mcp-a`
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])

    let resolveOlder: ((tools: ReturnType<typeof tool>[]) => void) | undefined
    mockListTools
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOlder = resolve
        })
      )
      .mockResolvedValueOnce([tool('new-tool', 'mcp-a')])

    const older = mcpService.discoverServerToolsWithMetadata(USER_ID, 'mcp-a', WORKSPACE_ID, false)
    await vi.waitFor(() => expect(mockListTools).toHaveBeenCalledTimes(1))

    mockCacheAdapter.beginMutation.mockRejectedValueOnce(new Error('transient ordering failure'))
    const newer = mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, true)
    await expect(newer).resolves.toEqual([tool('new-tool', 'mcp-a')])

    resolveOlder?.([tool('old-tool', 'mcp-a')])
    await expect(older).resolves.toEqual({
      tools: [tool('new-tool', 'mcp-a')],
      state: 'winner-cache',
    })

    expect(mockCacheAdapter.beginMutation).toHaveBeenCalledTimes(3)
    expect(cacheStore.get(serverKey)?.tools).toEqual([tool('new-tool', 'mcp-a')])
    expect(mockUpdateSet).toHaveBeenCalledTimes(1)
  })

  it('uses the cache mutation token to order database publication after a begin retry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])

      let rejectOlderBegin: ((error: Error) => void) | undefined
      mockCacheAdapter.beginMutation.mockImplementationOnce(
        () =>
          new Promise<number>((_resolve, reject) => {
            rejectOlderBegin = reject
          })
      )
      mockListTools
        .mockRejectedValueOnce(new Error('Later-started discovery failed'))
        .mockResolvedValueOnce([tool('retry-winner', 'mcp-a')])

      vi.setSystemTime(new Date('2030-02-01T00:00:00.000Z'))
      const older = mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, false)
      await vi.waitFor(() => expect(mockCacheAdapter.beginMutation).toHaveBeenCalledTimes(1))

      const laterMutationTime = new Date('2030-02-01T00:00:01.000Z')
      vi.setSystemTime(laterMutationTime)
      const later = mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, true)
      await expect(later).rejects.toThrow('Later-started discovery failed')

      const retriedMutationTime = new Date('2030-02-01T00:00:02.000Z')
      vi.setSystemTime(retriedMutationTime)
      rejectOlderBegin?.(new Error('Transient mutation start failure'))
      await expect(older).resolves.toEqual([tool('retry-winner', 'mcp-a')])

      const publications = mockUpdateSet.mock.calls
        .map(([update]) => update)
        .filter((update) => update.lastToolsRefresh)
      expect(publications.map((update) => update.connectionStatus)).toEqual([
        'disconnected',
        'connected',
      ])
      expect(publications.map((update) => update.lastToolsRefresh)).toEqual([
        laterMutationTime,
        retriedMutationTime,
      ])
      expect(cacheStore.get(`workspace:${WORKSPACE_ID}:server:mcp-a`)?.tools).toEqual([
        tool('retry-winner', 'mcp-a'),
      ])
      expect(cacheStore.has(`workspace:${WORKSPACE_ID}:server:mcp-a:failure`)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns live tools without publishing when cache ownership is unavailable', async () => {
    const serverKey = `workspace:${WORKSPACE_ID}:server:mcp-a`
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])

    let resolveOlder: ((tools: ReturnType<typeof tool>[]) => void) | undefined
    mockListTools
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOlder = resolve
        })
      )
      .mockResolvedValueOnce([tool('unowned-new-tool', 'mcp-a')])

    const older = mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, false)
    await vi.waitFor(() => expect(mockListTools).toHaveBeenCalledTimes(1))

    mockCacheAdapter.beginMutation
      .mockRejectedValueOnce(new Error('ordering unavailable'))
      .mockRejectedValueOnce(new Error('ordering unavailable'))
    const newer = mcpService.discoverServerToolsWithMetadata(USER_ID, 'mcp-a', WORKSPACE_ID, true)
    await expect(newer).resolves.toEqual({
      tools: [tool('unowned-new-tool', 'mcp-a')],
      state: 'unavailable',
    })

    resolveOlder?.([tool('owned-old-tool', 'mcp-a')])
    await expect(older).resolves.toEqual([tool('owned-old-tool', 'mcp-a')])

    expect(mockCacheAdapter.beginMutation).toHaveBeenCalledTimes(3)
    expect(cacheStore.get(serverKey)?.tools).toEqual([tool('owned-old-tool', 'mcp-a')])
    expect(mockCacheAdapter.set).not.toHaveBeenCalled()
    expect(mockCacheAdapter.delete).not.toHaveBeenCalled()
    expect(mockUpdateSet).toHaveBeenCalledTimes(1)
  })

  it('returns live tools but skips publication when mutation ownership stays unavailable', async () => {
    const reflectedCredential = 'opaque-cache-provider-message'
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockCacheAdapter.beginMutation
      .mockRejectedValueOnce(new Error(reflectedCredential))
      .mockRejectedValueOnce(new Error(reflectedCredential))
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])

    await expect(
      mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, true)
    ).resolves.toEqual([tool('a1', 'mcp-a')])

    expect(mockCacheAdapter.applyMutationIfCurrent).not.toHaveBeenCalled()
    expect(mockCacheAdapter.set).not.toHaveBeenCalled()
    expect(mockCacheAdapter.delete).not.toHaveBeenCalled()
    expect(mockUpdateSet).not.toHaveBeenCalled()
    expect(JSON.stringify(mockLogger?.warn.mock.calls)).not.toContain(reflectedCredential)
  })

  it('returns bulk live tools without publication when mutation ownership is unavailable', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockCacheAdapter.beginMutation
      .mockRejectedValueOnce(new Error('cache ordering unavailable'))
      .mockRejectedValueOnce(new Error('cache ordering unavailable'))
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])

    await expect(mcpService.discoverTools(USER_ID, WORKSPACE_ID, true)).resolves.toEqual([
      tool('a1', 'mcp-a'),
    ])

    expect(mockCacheAdapter.applyMutationIfCurrent).not.toHaveBeenCalled()
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('returns live tools but skips publication when the atomic cache transition fails', async () => {
    const reflectedCredential = 'opaque-atomic-cache-provider-message'
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockCacheAdapter.applyMutationIfCurrent.mockRejectedValueOnce(new Error(reflectedCredential))
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])

    await expect(
      mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, true)
    ).resolves.toEqual([tool('a1', 'mcp-a')])

    expect(mockCacheAdapter.beginMutation).toHaveBeenCalledTimes(1)
    expect(mockCacheAdapter.applyMutationIfCurrent).toHaveBeenCalledTimes(1)
    expect(mockUpdateSet).not.toHaveBeenCalled()
    expect(mockLogger?.warn).toHaveBeenCalledWith(
      'Failed to atomically update cache for server mcp-a',
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        error: expect.objectContaining({ name: 'Error' }),
      })
    )
    expect(JSON.stringify(mockLogger?.warn.mock.calls)).not.toContain(reflectedCredential)
  })

  it('best-effort deletes both cache keys when invalidation cannot be ordered', async () => {
    const serverKey = `workspace:${WORKSPACE_ID}:server:mcp-a`
    const failureKey = `${serverKey}:failure`
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    cacheStore.set(serverKey, {
      tools: [tool('stale-tool', 'mcp-a')],
      expiry: Date.now() + 60_000,
    })
    cacheStore.set(failureKey, { tools: [], expiry: Date.now() + 60_000 })
    mockCacheAdapter.beginMutation
      .mockRejectedValueOnce(new Error('cache ordering unavailable'))
      .mockRejectedValueOnce(new Error('cache ordering unavailable'))

    await mcpService.clearCache(WORKSPACE_ID)

    expect(cacheStore.has(serverKey)).toBe(false)
    expect(cacheStore.has(failureKey)).toBe(false)
    expect(mockCacheAdapter.delete).toHaveBeenCalledWith(serverKey)
    expect(mockCacheAdapter.delete).toHaveBeenCalledWith(failureKey)
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
    mockListTools
      .mockRejectedValueOnce(new Error('Request timed out'))
      .mockRejectedValueOnce(new Error('Request timed out'))

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'Request timed out'
    )

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionStatus: 'disconnected',
        // Raw SDK timeout text is mapped to a user-facing message before persisting.
        lastError: 'The MCP server took too long to respond and timed out',
        statusConfig: { consecutiveFailures: 1, lastSuccessfulDiscovery: null },
      })
    )
  })

  it('persists an allowlisted message when an upstream error reflects a custom credential', async () => {
    const reflectedCredential = 'opaque-custom-header-value'
    mockGetWorkspaceServersRows.mockResolvedValue([
      dbRow('mcp-a', 'A', {
        statusConfig: { consecutiveFailures: 0, lastSuccessfulDiscovery: null },
      }),
    ])
    mockListTools.mockRejectedValueOnce(
      new Error(`Provider rejected X-Custom-Credential: ${reflectedCredential}`)
    )

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      reflectedCredential
    )

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionStatus: 'disconnected',
        lastError: 'Connection failed',
        toolCount: 0,
      })
    )
    expect(JSON.stringify(mockUpdateSet.mock.calls)).not.toContain(reflectedCredential)
  })

  it('does not return or cache tools discovered from a stale server configuration', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools.mockResolvedValueOnce([tool('stale-tool', 'mcp-a')])
    mockUpdateSet.mockReturnValueOnce({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    })

    const tools = await mcpService.discoverTools(USER_ID, WORKSPACE_ID, true)

    expect(tools).toEqual([])
    expect(mockCacheAdapter.applyMutationIfCurrent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        key: `workspace:${WORKSPACE_ID}:server:mcp-a`,
        tools: [tool('stale-tool', 'mcp-a')],
        ttlMs: expect.any(Number),
      },
      [`workspace:${WORKSPACE_ID}:server:mcp-a:failure`]
    )
    expect(cacheStore.has(`workspace:${WORKSPACE_ID}:server:mcp-a`)).toBe(false)
  })

  it('supersedes an older discovery before it can publish status', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])

      let resolveOlder: ((tools: ReturnType<typeof tool>[]) => void) | undefined
      let resolveNewer: ((tools: ReturnType<typeof tool>[]) => void) | undefined
      mockListTools
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveOlder = resolve
          })
        )
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveNewer = resolve
          })
        )

      const olderStartedAt = new Date('2030-02-01T00:00:00.000Z')
      vi.setSystemTime(olderStartedAt)
      const older = mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, false)
      await vi.waitFor(() => expect(mockListTools).toHaveBeenCalledTimes(1))

      const newerStartedAt = new Date('2030-02-01T00:00:01.000Z')
      vi.setSystemTime(newerStartedAt)
      const newer = mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, true)
      await vi.waitFor(() => expect(mockListTools).toHaveBeenCalledTimes(2))

      vi.setSystemTime(new Date('2030-02-01T00:00:02.000Z'))
      resolveOlder?.([tool('old-tool', 'mcp-a')])
      await expect(older).resolves.toEqual([])

      vi.setSystemTime(new Date('2030-02-01T00:00:03.000Z'))
      resolveNewer?.([tool('new-tool', 'mcp-a')])
      await expect(newer).resolves.toEqual([tool('new-tool', 'mcp-a')])

      const publishedRefreshTimes = mockUpdateSet.mock.calls
        .map(([update]) => update)
        .filter((update) => update.connectionStatus === 'connected')
        .map((update) => update.lastToolsRefresh)
      expect(publishedRefreshTimes).toHaveLength(1)
      expect(publishedRefreshTimes[0].getTime()).toBeGreaterThanOrEqual(newerStartedAt.getTime())
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not write status after its cache mutation is superseded', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])

    let resolveList: ((tools: ReturnType<typeof tool>[]) => void) | undefined
    mockListTools.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve
      })
    )

    let releaseOlderCacheMutation: (() => void) | undefined
    const olderCacheMutationGate = new Promise<void>((resolve) => {
      releaseOlderCacheMutation = resolve
    })
    const defaultApply = mockCacheAdapter.applyMutationIfCurrent.getMockImplementation()
    mockCacheAdapter.applyMutationIfCurrent.mockImplementationOnce(
      async (
        scopeKey: string,
        mutationId: number,
        setEntry: { key: string; tools: unknown[]; ttlMs: number } | null,
        deleteKeys: string[]
      ) => {
        await olderCacheMutationGate
        return defaultApply?.(scopeKey, mutationId, setEntry, deleteKeys) ?? false
      }
    )

    const discovery = mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, false)
    await vi.waitFor(() => expect(mockListTools).toHaveBeenCalledTimes(1))
    resolveList?.([tool('superseded-tool', 'mcp-a')])
    await vi.waitFor(() => expect(mockCacheAdapter.applyMutationIfCurrent).toHaveBeenCalledTimes(1))

    await mockCacheAdapter.beginMutation(`workspace:${WORKSPACE_ID}:server:mcp-a`)
    releaseOlderCacheMutation?.()

    await expect(discovery).resolves.toEqual([])
    expect(mockUpdateSet).not.toHaveBeenCalled()
    expect(cacheStore.has(`workspace:${WORKSPACE_ID}:server:mcp-a`)).toBe(false)
  })

  it('waits for bulk discovery status publication before returning', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])

    let releaseStatus: (() => void) | undefined
    const pendingStatus = new Promise<void>((resolve) => {
      releaseStatus = resolve
    })
    mockUpdateSet.mockReturnValueOnce({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue(pendingStatus.then(() => [{ id: 'mcp-a' }])),
      }),
    })

    let settled = false
    const discovery = mcpService.discoverTools(USER_ID, WORKSPACE_ID, true).finally(() => {
      settled = true
    })

    await vi.waitFor(() => expect(mockListTools).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseStatus?.()
    await expect(discovery).resolves.toEqual([tool('a1', 'mcp-a')])
  })

  it('keeps a newer successful cache entry when an older failure finishes later', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])

    let rejectOlder: ((error: Error) => void) | undefined
    const olderList = new Promise<never>((_resolve, reject) => {
      rejectOlder = reject
    })
    mockListTools.mockReturnValueOnce(olderList).mockResolvedValueOnce([tool('new-tool', 'mcp-a')])

    let releaseOlderFailureCache: (() => void) | undefined
    const olderFailureCacheGate = new Promise<void>((resolve) => {
      releaseOlderFailureCache = resolve
    })
    const defaultApply = mockCacheAdapter.applyMutationIfCurrent.getMockImplementation()
    mockCacheAdapter.applyMutationIfCurrent.mockImplementationOnce(
      async (
        scopeKey: string,
        mutationId: number,
        setEntry: { key: string; tools: unknown[]; ttlMs: number } | null,
        deleteKeys: string[]
      ) => {
        await olderFailureCacheGate
        return defaultApply?.(scopeKey, mutationId, setEntry, deleteKeys) ?? false
      }
    )

    const older = mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, false)
    await vi.waitFor(() => expect(mockListTools).toHaveBeenCalledTimes(1))
    rejectOlder?.(new Error('Older request failed'))

    const newer = mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID, true)
    await expect(newer).resolves.toEqual([tool('new-tool', 'mcp-a')])

    releaseOlderFailureCache?.()
    await expect(older).rejects.toThrow('Older request failed')

    expect(cacheStore.get(`workspace:${WORKSPACE_ID}:server:mcp-a`)?.tools).toEqual([
      tool('new-tool', 'mcp-a'),
    ])
    expect(cacheStore.has(`workspace:${WORKSPACE_ID}:server:mcp-a:failure`)).toBe(false)
  })

  it('retries a transient tools/list timeout and succeeds on the second attempt', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools
      .mockRejectedValueOnce(new Error('Request timed out'))
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])

    const tools = await mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)

    expect(tools.map((t) => t.name)).toEqual(['a1'])
    expect(mockListTools).toHaveBeenCalledTimes(2)
  })

  it('persists and negative-caches per-server UnauthorizedError for headers auth', async () => {
    const reflectedCredential = 'Bearer static-secret-for-server-discovery'
    mockGetWorkspaceServersRows.mockResolvedValue([
      dbRow('mcp-a', 'A', {
        statusConfig: { consecutiveFailures: 0, lastSuccessfulDiscovery: null },
      }),
    ])
    mockListTools.mockRejectedValueOnce(
      new UnauthorizedError(`Rejected Authorization: ${reflectedCredential}`)
    )

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      reflectedCredential
    )

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionStatus: 'disconnected',
        lastError: 'Authentication failed',
        statusConfig: { consecutiveFailures: 1, lastSuccessfulDiscovery: null },
      })
    )
    expect(JSON.stringify(mockUpdateSet.mock.calls)).not.toContain(reflectedCredential)
    expect(JSON.stringify(mockCacheAdapter.applyMutationIfCurrent.mock.calls)).not.toContain(
      reflectedCredential
    )
    expect(JSON.stringify(mockLogger?.warn.mock.calls)).not.toContain(reflectedCredential)

    mockListTools.mockClear()
    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'cooldown'
    )
    expect(mockListTools).not.toHaveBeenCalled()
  })

  it('keeps per-server UnauthorizedError soft-pending for OAuth auth', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A', { authType: 'oauth' })])
    mockResolveEnvVars.mockRejectedValue(new UnauthorizedError('OAuth token rejected'))

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'OAuth token rejected'
    )

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionStatus: 'disconnected',
        lastError: null,
      })
    )
    expect(mockCacheAdapter.applyMutationIfCurrent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ key: `workspace:${WORKSPACE_ID}:server:mcp-a:failure` }),
      expect.anything()
    )

    mockResolveEnvVars.mockClear()
    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'OAuth token rejected'
    )
    expect(mockResolveEnvVars).toHaveBeenCalledTimes(1)
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

  it('recomputes a failure count after a concurrent status update wins the CAS', async () => {
    const beforeSuccess = dbRow('mcp-a', 'A', {
      statusConfig: { consecutiveFailures: 2, lastSuccessfulDiscovery: null },
    })
    const afterSuccess = dbRow('mcp-a', 'A', {
      statusConfig: {
        consecutiveFailures: 0,
        lastSuccessfulDiscovery: '2030-02-01T00:00:00.000Z',
      },
    })
    mockGetWorkspaceServersRows
      .mockResolvedValueOnce([beforeSuccess])
      .mockResolvedValueOnce([beforeSuccess])
      .mockResolvedValueOnce([afterSuccess])
    mockUpdateReturning.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'mcp-a' }])
    mockListTools.mockRejectedValueOnce(new Error('Connection refused'))

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'Connection refused'
    )

    const failureUpdates = mockUpdateSet.mock.calls
      .map(([update]) => update)
      .filter((update) => update.lastError === 'Connection failed')
    expect(failureUpdates).toEqual([
      expect.objectContaining({
        connectionStatus: 'error',
        statusConfig: { consecutiveFailures: 3, lastSuccessfulDiscovery: null },
      }),
      expect.objectContaining({
        connectionStatus: 'disconnected',
        statusConfig: {
          consecutiveFailures: 1,
          lastSuccessfulDiscovery: '2030-02-01T00:00:00.000Z',
        },
      }),
    ])
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
    mockUpdateReturning.mockResolvedValue([])

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'Older request failed'
    )

    mockUpdateReturning.mockResolvedValue([{ id: 'server-1' }])
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])
    const tools = await mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)

    expect(tools.map((tool) => tool.name)).toEqual(['a1'])
    expect(mockListTools).toHaveBeenCalledTimes(2)
  })
})
