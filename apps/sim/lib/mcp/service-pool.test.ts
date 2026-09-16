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
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockMcpClient,
  mockCallTool,
  mockListTools,
  mockConnect,
  mockDisconnect,
  mockAcquire,
  mockRelease,
  mockResolveEnvVars,
  mockCacheAdapter,
  poolClient,
} = vi.hoisted(() => {
  const mockCallTool = vi.fn()
  const mockListTools = vi.fn()
  const mockConnect = vi.fn()
  const mockDisconnect = vi.fn()
  const mockRelease = vi.fn(async () => {})
  const poolClient = {
    callTool: mockCallTool,
    listTools: mockListTools,
    disconnect: vi.fn(),
    getResolvedSecretTraceProvenance: vi.fn(() => ({
      version: 1 as const,
      complete: true,
      entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-token' }],
      scope: { userId: 'user-1', workspaceId: 'ws-1' },
    })),
  }
  return {
    mockCallTool,
    mockListTools,
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
            listTools: mockListTools,
            hasListChangedCapability: vi.fn(() => false),
            onClose: vi.fn(),
            getResolvedSecretTraceProvenance: poolClient.getResolvedSecretTraceProvenance,
          })
        }
      }
    ),
  }
})

vi.mock('@/lib/mcp/connection-pool', () => ({
  mcpConnectionPool: { acquire: mockAcquire, evictServer: vi.fn() },
}))
vi.mock('@/lib/mcp/connection-manager', () => ({ mcpConnectionManager: null }))
vi.mock('@/lib/mcp/client', () => ({ McpClient: MockMcpClient }))

const WORKSPACE_ID = 'ws-1'
const USER_ID = 'user-1'

const SERVER_ROW = {
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
}

vi.mock('@/lib/mcp/domain-check', () => ({
  MCP_EGRESS_PROFILE: 'selfHostedService',
  OAUTH_EGRESS_PROFILE: 'contentFetch',
  McpSsrfError: class McpSsrfError extends Error {},
  isMcpDomainAllowed: () => true,
  validateMcpDomain: () => {},
  validateMcpServerSsrf: async () => '203.0.113.10',
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

import { withMcpOauthRefreshLock } from '@/lib/mcp/oauth'
import { mcpService } from '@/lib/mcp/service'

describe('McpService connection reuse wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    // Every select here is getServerConfig's `.where(...).limit(1)`; the
    // persistent override keeps the row available across retries.
    dbChainMockFns.limit.mockResolvedValue([SERVER_ROW])
    mockResolveEnvVars.mockImplementation(async (config: unknown) => ({ config }))
    mockAcquire.mockResolvedValue({ client: poolClient, release: mockRelease })
    mockCallTool.mockResolvedValue({ content: [] })
    mockListTools.mockResolvedValue([])
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('propagates initial managed credential errors before constructing a connection', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ ...SERVER_ROW, authType: 'oauth' }])
    const error = new Error('Managed credential disabled')
    await expect(
      mcpService.executeManagedMcpTool({
        connectionId: 'disabled-grant',
        serverId: SERVER_ROW.id,
        scope: { kind: 'workspace', workspaceId: WORKSPACE_ID },
        toolCall: { name: 'slow', arguments: {} },
        loadAuthProvider: vi.fn().mockRejectedValue(error),
      })
    ).rejects.toBe(error)
    expect(MockMcpClient).not.toHaveBeenCalled()
  })

  it('keeps managed tool execution outside the refresh mutex and passes a reloadable grant', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ ...SERVER_ROW, authType: 'oauth' }])
    const initialProvider = {}
    const loadAuthProvider = vi.fn().mockResolvedValue(initialProvider)
    const signal = new AbortController().signal
    await mcpService.executeManagedMcpTool({
      connectionId: 'personal-grant',
      serverId: SERVER_ROW.id,
      scope: { kind: 'workspace', workspaceId: WORKSPACE_ID },
      toolCall: { name: 'slow', arguments: {} },
      loadAuthProvider,
      signal,
      timeoutMs: 300_000,
    })

    expect(loadAuthProvider).toHaveBeenCalledTimes(1)
    expect(withMcpOauthRefreshLock).not.toHaveBeenCalled()
    expect(MockMcpClient).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthCredentials: {
          credentialId: 'personal-grant',
          loadProvider: loadAuthProvider,
          initialProvider,
        },
      })
    )
    expect(mockCallTool).toHaveBeenCalledWith(
      { name: 'slow', arguments: {} },
      { signal, timeoutMs: 300_000 }
    )
    expect(mockAcquire).not.toHaveBeenCalled()
    expect(mockDisconnect).toHaveBeenCalledTimes(1)
  })

  it('leases from the pool (keyed by server+workspace+user) and never disconnects on a hit', async () => {
    await mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID)

    expect(mockAcquire).toHaveBeenCalledTimes(1)
    expect(mockAcquire).toHaveBeenCalledWith(
      expect.objectContaining({ key: `server-1:${WORKSPACE_ID}:${USER_ID}`, serverId: 'server-1' })
    )
    expect(mockCallTool).toHaveBeenCalledTimes(1)
    expect(mockRelease).toHaveBeenCalledWith(false, false)
    expect(poolClient.disconnect).not.toHaveBeenCalled()
    // A pool hit must not re-resolve env vars (acquire never invoked `create`).
    expect(mockResolveEnvVars).not.toHaveBeenCalled()
  })

  it('emits the pooled connection provenance on every invocation', async () => {
    const onProvenance = vi.fn()

    await mcpService.executeTool(
      USER_ID,
      'server-1',
      { name: 'first', arguments: {} },
      WORKSPACE_ID,
      undefined,
      onProvenance
    )
    await mcpService.executeTool(
      USER_ID,
      'server-1',
      { name: 'second', arguments: {} },
      WORKSPACE_ID,
      undefined,
      onProvenance
    )

    expect(onProvenance).toHaveBeenCalledTimes(2)
    expect(onProvenance).toHaveBeenNthCalledWith(1, {
      version: 1,
      complete: true,
      entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-token' }],
      scope: { userId: USER_ID, workspaceId: WORKSPACE_ID },
    })
    expect(onProvenance).toHaveBeenNthCalledWith(2, {
      version: 1,
      complete: true,
      entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-token' }],
      scope: { userId: USER_ID, workspaceId: WORKSPACE_ID },
    })
  })

  it('emits cold-connection provenance once even though the connected client retains it', async () => {
    const onProvenance = vi.fn()
    const provenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-token' }],
      scope: { userId: USER_ID, workspaceId: WORKSPACE_ID },
    }
    mockResolveEnvVars.mockImplementationOnce(
      async (
        config: unknown,
        _userId: unknown,
        _workspaceId: unknown,
        options: {
          onResolvedSecretTraceProvenance?: (value: typeof provenance) => void
        }
      ) => {
        options.onResolvedSecretTraceProvenance?.(provenance)
        return { config, resolvedSecretTraceProvenance: provenance }
      }
    )
    mockAcquire.mockImplementationOnce(
      async ({ create }: { create: () => Promise<typeof poolClient> }) => ({
        client: await create(),
        release: mockRelease,
      })
    )

    await mcpService.executeTool(
      USER_ID,
      'server-1',
      { name: 'do', arguments: {} },
      WORKSPACE_ID,
      undefined,
      onProvenance
    )

    expect(mockResolveEnvVars).toHaveBeenCalledTimes(1)
    expect(onProvenance).toHaveBeenCalledTimes(1)
    expect(onProvenance).toHaveBeenCalledWith(provenance)
  })

  it('emits cold-connection provenance for tools/list', async () => {
    const onProvenance = vi.fn()
    const provenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-token' }],
      scope: { userId: USER_ID, workspaceId: WORKSPACE_ID },
    }
    mockResolveEnvVars.mockImplementationOnce(
      async (
        config: unknown,
        _userId: unknown,
        _workspaceId: unknown,
        options: {
          onResolvedSecretTraceProvenance?: (value: typeof provenance) => void
        }
      ) => {
        options.onResolvedSecretTraceProvenance?.(provenance)
        return { config, resolvedSecretTraceProvenance: provenance }
      }
    )
    mockAcquire.mockImplementationOnce(
      async ({ create }: { create: () => Promise<typeof poolClient> }) => ({
        client: await create(),
        release: mockRelease,
      })
    )

    await mcpService.discoverServerTools(USER_ID, 'server-1', WORKSPACE_ID, true, onProvenance)

    expect(mockResolveEnvVars).toHaveBeenCalledTimes(1)
    expect(mockListTools).toHaveBeenCalledTimes(1)
    expect(onProvenance).toHaveBeenCalledTimes(1)
    expect(onProvenance).toHaveBeenCalledWith(provenance)
  })

  it('emits retained provenance on every warm-pool tools/list invocation', async () => {
    const onProvenance = vi.fn()

    await mcpService.discoverServerTools(USER_ID, 'server-1', WORKSPACE_ID, true, onProvenance)
    await mcpService.discoverServerTools(USER_ID, 'server-1', WORKSPACE_ID, true, onProvenance)

    expect(mockResolveEnvVars).not.toHaveBeenCalled()
    expect(mockListTools).toHaveBeenCalledTimes(2)
    expect(onProvenance).toHaveBeenCalledTimes(2)
    expect(onProvenance).toHaveBeenNthCalledWith(1, {
      version: 1,
      complete: true,
      entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-token' }],
      scope: { userId: USER_ID, workspaceId: WORKSPACE_ID },
    })
    expect(onProvenance).toHaveBeenNthCalledWith(2, {
      version: 1,
      complete: true,
      entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-token' }],
      scope: { userId: USER_ID, workspaceId: WORKSPACE_ID },
    })
  })

  it('reports incomplete provenance when a pooled tools/list client has no retained report', async () => {
    const onProvenance = vi.fn()
    const legacyClient = {
      ...poolClient,
      getResolvedSecretTraceProvenance: undefined,
    }
    mockAcquire.mockResolvedValueOnce({ client: legacyClient, release: mockRelease })

    await mcpService.discoverServerTools(USER_ID, 'server-1', WORKSPACE_ID, true, onProvenance)

    expect(mockListTools).toHaveBeenCalledTimes(1)
    expect(onProvenance).toHaveBeenCalledWith({
      version: 1,
      complete: false,
      entries: [],
      scope: { userId: USER_ID, workspaceId: WORKSPACE_ID },
    })
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

    expect(mockRelease).toHaveBeenCalledWith(true, false)
  })

  it('keeps the pooled connection warm on a benign (non-connection) tool error', async () => {
    mockCallTool.mockRejectedValue(new Error('tool blew up'))

    await expect(
      mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID)
    ).rejects.toThrow()

    expect(mockRelease).toHaveBeenCalledWith(false, false)
  })

  it('keeps the pooled connection warm on a request timeout (does not retire the session)', async () => {
    // A streamable-HTTP request timeout aborts only that request's stream; the session stays
    // healthy for the next request, so a timeout must NOT poison the lease (matches every
    // production MCP client and avoids a connect/stall/reconnect churn loop). It DOES report
    // sawTimeout so the pool's consecutive-timeout circuit breaker can retire a half-open
    // transport after repeated strikes.
    mockCallTool.mockRejectedValue(new Error('Request timed out'))

    await expect(
      mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID)
    ).rejects.toThrow()

    expect(mockRelease).toHaveBeenCalledWith(false, true)
  })

  it('classifies an AbortSignal.timeout-shaped TimeoutError as a timeout for the breaker', async () => {
    // DOMException name 'TimeoutError' with a message that lacks "timed out".
    mockCallTool.mockRejectedValue(
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      })
    )

    await expect(
      mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID)
    ).rejects.toThrow()

    expect(mockRelease).toHaveBeenCalledWith(false, true)
  })

  it('poisons the lease on an auth failure so a rotated credential is re-resolved', async () => {
    mockCallTool.mockRejectedValue(new UnauthorizedError('token rejected'))

    await expect(
      mcpService.executeTool(USER_ID, 'server-1', { name: 'do', arguments: {} }, WORKSPACE_ID)
    ).rejects.toThrow()

    expect(mockRelease).toHaveBeenCalledWith(true, false)
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
    expect(mockRelease).toHaveBeenCalledWith(true, false)
    expect(mockAcquire).toHaveBeenCalledTimes(2)
  })

  it('reports both retained and rotated provenance when an auth retry rebuilds the client', async () => {
    const staleProvenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-token-v1' }],
      scope: { userId: USER_ID, workspaceId: WORKSPACE_ID },
    }
    const rotatedProvenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-token-v2' }],
      scope: { userId: USER_ID, workspaceId: WORKSPACE_ID },
    }
    const staleClient = {
      ...poolClient,
      getResolvedSecretTraceProvenance: vi.fn(() => staleProvenance),
    }
    const rotatedClient = {
      ...poolClient,
      getResolvedSecretTraceProvenance: vi.fn(() => rotatedProvenance),
    }
    mockAcquire
      .mockResolvedValueOnce({ client: staleClient, release: mockRelease })
      .mockResolvedValueOnce({ client: rotatedClient, release: mockRelease })
    mockCallTool
      .mockRejectedValueOnce(new UnauthorizedError('stale key'))
      .mockResolvedValueOnce({ content: [] })
    const onProvenance = vi.fn()

    await mcpService.executeTool(
      USER_ID,
      'server-1',
      { name: 'do', arguments: {} },
      WORKSPACE_ID,
      undefined,
      onProvenance
    )

    expect(onProvenance.mock.calls.map(([provenance]) => provenance)).toEqual([
      staleProvenance,
      rotatedProvenance,
    ])
  })
})
