import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { dbChainMockFns, loggerMock, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
} = vi.hoisted(() => {
  const mockListTools = vi.fn()
  const mockConnect = vi.fn()
  const mockDisconnect = vi.fn()
  // In-memory cache adapter so the service never touches the real Redis the
  // local .env points at (unreachable in CI/sandbox → hangs). Honors TTL via
  // an expiry timestamp so negative-cache assertions behave like production.
  const cacheStore = new Map<string, { tools: unknown[]; expiry: number }>()
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
    clear: vi.fn(async () => {
      cacheStore.clear()
    }),
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
  }
})

/**
 * Routes every select chain to `mockGetWorkspaceServersRows`: `where(...)`
 * resolves the workspace's rows AND exposes `.limit()` for chains like
 * `getServerConfig` that do `select().from().where().limit(1)`.
 */
function wireSelectsToWorkspaceRows() {
  dbChainMockFns.from.mockImplementation(() => {
    const rows = Promise.resolve(mockGetWorkspaceServersRows())
    return {
      where: () =>
        Object.assign(rows, {
          limit: (n: number) => rows.then((r: unknown[]) => r.slice(0, n)),
        }),
    }
  })
}

vi.mock('@/lib/mcp/client', () => ({
  McpClient: MockMcpClient,
}))

vi.mock('@/lib/mcp/connection-manager', () => ({
  mcpConnectionManager: null,
}))

vi.mock('@/lib/mcp/domain-check', () => ({
  MCP_EGRESS_PROFILE: 'selfHostedService',
  OAUTH_EGRESS_PROFILE: 'contentFetch',
  McpSsrfError: class McpSsrfError extends Error {},
  isMcpDomainAllowed: (...args: unknown[]) => mockIsDomainAllowed(...args),
  validateMcpDomain: (...args: unknown[]) => mockValidateDomain(...args),
  validateMcpServerSsrf: (...args: unknown[]) => mockValidateSsrf(...args),
}))

vi.mock('@/lib/mcp/oauth', () => ({
  getOrCreateOauthRow: vi.fn(),
  loadPreregisteredClient: vi.fn(),
  SimMcpOauthProvider: vi.fn(),
  withMcpOauthRefreshLock: vi.fn((_id: string, fn: () => Promise<unknown>) => fn()),
}))

vi.mock('@/lib/mcp/resolve-config', () => ({
  resolveMcpConfigEnvVars: (...args: unknown[]) => mockResolveEnvVars(...args),
}))

vi.mock('@/lib/mcp/storage', () => ({
  createMcpCacheAdapter: () => mockCacheAdapter,
  getMcpCacheType: () => 'memory',
}))

import { MAX_MCP_LAST_ERROR_LENGTH } from '@/lib/mcp/constants'
import { mcpService } from '@/lib/mcp/service'
import { McpOauthAuthorizationRequiredError } from '@/lib/mcp/types'
import { MCP_CONSTANTS } from '@/lib/mcp/utils'

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

/**
 * Renders a mocked drizzle `sql` fragment, recursing into nested fragments.
 *
 * The failure status write computes the consecutive-failure counter in SQL
 * rather than reading it, adding one and writing it back, so its
 * `connectionStatus` and `statusConfig` arrive as expressions. Rendering them is
 * the only way to assert the increment and the error threshold without a live
 * database — and asserting on a literal object would be asserting the old
 * read-modify-write back into existence.
 */
function renderSql(fragment: unknown): string {
  const node = fragment as { strings?: readonly string[]; values?: readonly unknown[] }
  if (!node?.strings) return String(fragment)
  return node.strings.reduce<string>(
    (rendered, chunk, index) =>
      index === 0 ? chunk : `${rendered}${renderSql(node.values?.[index - 1])}${chunk}`,
    ''
  )
}

/** The values written by the failure branch of the discovery status write. */
function failureStatusWrite(lastError: string): Record<string, unknown> {
  const call = dbChainMockFns.set.mock.calls.find(
    ([values]) => (values as Record<string, unknown> | undefined)?.lastError === lastError
  )
  expect(call, `no status write carried lastError ${lastError}`).toBeDefined()
  return (call as unknown[])[0] as Record<string, unknown>
}

/**
 * Pins the failure write's SQL: the counter is incremented from the stored blob
 * in the same statement, and the row flips to `error` at the threshold.
 */
function expectSqlSideFailureIncrement(values: Record<string, unknown>): void {
  const statusConfig = renderSql(values.statusConfig)
  expect(statusConfig).toContain("'consecutiveFailures'")
  expect(statusConfig).toContain("->> 'consecutiveFailures')::int, 0) + 1")
  expect(statusConfig).toContain("-> 'lastSuccessfulDiscovery'")

  const connectionStatus = renderSql(values.connectionStatus)
  expect(connectionStatus).toContain(') + 1 >= ')
  expect(connectionStatus).toContain(String(MCP_CONSTANTS.MAX_CONSECUTIVE_FAILURES))
  expect(connectionStatus).toContain("THEN 'error' ELSE 'disconnected' END")
}

describe('McpService.discoverTools per-server caching', () => {
  beforeEach(async () => {
    resetDbChainMock()
    wireSelectsToWorkspaceRows()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'server-1' }])
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
    // The McpService singleton holds cache state across imports.
    await mcpService.clearCache()
  })

  afterAll(() => {
    resetDbChainMock()
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
    mockListTools.mockRejectedValue(
      new UnauthorizedError(`Rejected Authorization: ${reflectedCredential}`)
    )

    const first = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(first).toEqual([])

    await vi.waitFor(() => {
      expectSqlSideFailureIncrement(failureStatusWrite('Authentication failed'))
      expect(mockCacheAdapter.set).toHaveBeenCalledWith(
        `workspace:${WORKSPACE_ID}:server:mcp-a:failure`,
        [],
        expect.any(Number)
      )
    })
    expect(JSON.stringify(dbChainMockFns.set.mock.calls)).not.toContain(reflectedCredential)
    expect(JSON.stringify(mockCacheAdapter.set.mock.calls)).not.toContain(reflectedCredential)
    expect(JSON.stringify(mockLogger?.warn.mock.calls)).not.toContain(reflectedCredential)

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
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionStatus: 'disconnected',
          lastError: null,
        })
      )
    })
    expect(mockCacheAdapter.set).not.toHaveBeenCalledWith(
      `workspace:${WORKSPACE_ID}:server:mcp-a:failure`,
      [],
      expect.any(Number)
    )

    mockResolveEnvVars.mockClear()
    await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(mockResolveEnvVars).toHaveBeenCalledTimes(1)
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

  it('recovers a rotated headers-auth credential via a single discovery retry', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    // Stale key 401s once, then the retry re-resolves and succeeds.
    mockListTools
      .mockRejectedValueOnce(new UnauthorizedError('stale key'))
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])

    const tools = await mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)

    expect(tools).toHaveLength(1)
    expect(mockListTools).toHaveBeenCalledTimes(2)
  })

  /**
   * The counter used to be read, incremented in JS, and written back. Two
   * concurrent failures both read N and wrote N+1, losing a count, so a flapping
   * server could sit below the threshold forever and never flip to `error`. The
   * increment and the threshold comparison now happen in the one statement that
   * writes them.
   */
  it('promotes to error by incrementing the failure counter in the write itself', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([
      dbRow('mcp-a', 'A', {
        statusConfig: { consecutiveFailures: 2, lastSuccessfulDiscovery: null },
      }),
    ])
    mockListTools.mockRejectedValueOnce(new Error('Connection refused'))

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'Connection refused'
    )

    expectSqlSideFailureIncrement(failureStatusWrite('Connection refused'))
  })

  /**
   * A URL that is not an MCP endpoint answers the discovery POST with whatever
   * it serves, and the transport folds that body verbatim into the error. The
   * unbounded message used to land in `last_error`, which both `list` and `get`
   * republish, so one misconfigured URL could persist and re-serve an entire
   * remote document.
   */
  it('bounds the persisted lastError instead of storing a whole remote body', async () => {
    const remoteBody = `<!doctype html><html><body>${'x'.repeat(20000)}</body></html>`
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools.mockRejectedValueOnce(new Error(remoteBody))

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow()

    const write = dbChainMockFns.set.mock.calls
      .map(([values]) => values as Record<string, unknown> | undefined)
      .find((values) => typeof values?.lastError === 'string' && values.lastError !== null)
    expect(write, 'no status write carried a lastError').toBeDefined()
    const lastError = write?.lastError as string
    expect(lastError.length).toBeLessThanOrEqual(MAX_MCP_LAST_ERROR_LENGTH + 3)
    expect(lastError.endsWith('...')).toBe(true)
    expect(lastError).toContain('<!doctype html>')
  })

  /**
   * A discovery that started before a newer attempt landed must not overwrite
   * it, and neither outcome may write onto a foreign or soft-deleted row. The
   * success branch used to guard on the id alone.
   */
  it('guards the success status write with workspace, liveness and staleness', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])

    await mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)

    const guard = JSON.stringify(dbChainMockFns.where.mock.calls)
    expect(guard).toContain('deletedAt')
    expect(guard).toContain('lastConnected')
    expect(guard).toContain(WORKSPACE_ID)
  })

  it('does not negative-cache a failure older than a successful discovery', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools.mockRejectedValueOnce(new Error('Older request failed'))
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)).rejects.toThrow(
      'Older request failed'
    )

    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])
    const tools = await mcpService.discoverServerTools(USER_ID, 'mcp-a', WORKSPACE_ID)

    expect(tools.map((tool) => tool.name)).toEqual(['a1'])
    expect(mockListTools).toHaveBeenCalledTimes(2)
  })
})
