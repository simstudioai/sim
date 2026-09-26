import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import {
  executionLimitsMock,
  executionLimitsMockFns,
} from '@sim/testing/mocks/execution-limits.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSdkConnect, mockSdkListTools, mockPinnedClose } = vi.hoisted(() => ({
  mockSdkConnect: vi.fn().mockResolvedValue(undefined),
  mockSdkListTools: vi.fn().mockResolvedValue({ tools: [] }),
  mockPinnedClose: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/mcp/pinned-fetch', () => ({
  createGuardedMcpFetch: vi.fn(() => ({ fetch: vi.fn(), close: mockPinnedClose })),
  createPinnedPrivateMcpFetch: vi.fn(() => ({ fetch: vi.fn(), close: mockPinnedClose })),
}))

/**
 * Capture the notification handler registered via `client.setNotificationHandler()`.
 * This lets us simulate the MCP SDK delivering a `tools/list_changed` notification.
 */
let capturedNotificationHandler: (() => Promise<void>) | null = null

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(
    class {
      constructor() {
        Object.assign(this, {
          connect: mockSdkConnect,
          close: vi.fn().mockResolvedValue(undefined),
          getServerVersion: vi.fn().mockReturnValue('2025-06-18'),
          getServerCapabilities: vi.fn().mockReturnValue({ tools: { listChanged: true } }),
          setNotificationHandler: vi
            .fn()
            .mockImplementation((_schema: unknown, handler: () => Promise<void>) => {
              capturedNotificationHandler = handler
            }),
          listTools: mockSdkListTools,
        })
      }
    }
  ),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(
    class {
      onclose: null = null
      sessionId = 'test-session'
    }
  ),
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ToolListChangedNotificationSchema: { method: 'notifications/tools/list_changed' },
}))

vi.mock('@/lib/core/execution-limits', () => executionLimitsMock)

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { McpClient } from '@/lib/mcp/client'
import { createGuardedMcpFetch, createPinnedPrivateMcpFetch } from '@/lib/mcp/pinned-fetch'
import {
  type McpClientOptions,
  McpOauthAuthorizationRequiredError,
  type McpServerConfig,
} from '@/lib/mcp/types'

executionLimitsMockFns.mockGetMaxExecutionTimeout.mockReturnValue(30000)

const mockLogger = getMockLogger('McpClient')

function createConfig(): McpServerConfig {
  return {
    id: 'server-1',
    name: 'Test Server',
    transport: 'streamable-http',
    url: 'https://test.example.com/mcp',
  }
}

describe('McpClient notification handler', () => {
  beforeEach(() => {
    capturedNotificationHandler = null
    mockSdkConnect.mockResolvedValue(undefined)
    mockSdkListTools.mockResolvedValue({ tools: [] })
    // clearAllMocks resets call history but not implementations; re-establish the
    // default so a per-test override can't bleed into later tests.
    vi.mocked(getMaxExecutionTimeout).mockReturnValue(30_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves authorization-required errors raised by a locked credential reload', async () => {
    const error = new McpOauthAuthorizationRequiredError('server-1', 'Test Server')
    mockSdkConnect.mockRejectedValueOnce(error)
    const client = new McpClient({ config: createConfig() })
    await expect(client.connect()).rejects.toBe(error)
    expect(client.getStatus().lastError).toBeUndefined()
  })

  it('bounds tools/list with an idle timeout, hard cap, and progress reset', async () => {
    const client = new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await client.connect()
    await client.listTools()

    expect(mockSdkListTools).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        timeout: 30_000,
        maxTotalTimeout: expect.any(Number),
        resetTimeoutOnProgress: true,
        onprogress: expect.any(Function),
      })
    )
  })

  it('stops paginating when the server repeats a cursor (loop guard)', async () => {
    mockSdkListTools.mockResolvedValue({ tools: [{ name: 'x' }], nextCursor: 'same' })
    const client = new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await client.connect()
    const tools = await client.listTools()

    // Page 1 sets cursor 'same'; page 2 returns 'same' again → guard stops. Not 50 pages.
    expect(mockSdkListTools).toHaveBeenCalledTimes(2)
    expect(tools).toHaveLength(2)
  })

  it('returns partial tools when a later page fails', async () => {
    mockSdkListTools
      .mockResolvedValueOnce({ tools: [{ name: 'a' }], nextCursor: 'c1' })
      .mockRejectedValueOnce(new Error('page 2 blew up'))
    const client = new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await client.connect()
    const tools = await client.listTools()

    expect(tools.map((t) => t.name)).toEqual(['a'])
  })

  it('fails instead of returning partial tools when complete discovery is required', async () => {
    mockSdkListTools
      .mockResolvedValueOnce({ tools: [{ name: 'a' }], nextCursor: 'c1' })
      .mockRejectedValueOnce(new Error('page 2 blew up'))
    const client = new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await client.connect()
    await expect(client.listTools(undefined, { requireComplete: true })).rejects.toThrow(
      'page 2 blew up'
    )
  })

  it('logs connection diagnostics without header values', async () => {
    const client = new McpClient({
      config: {
        ...createConfig(),
        authType: 'headers',
        headers: { Authorization: 'Bearer do-not-log', 'X-API-Key': 'also-secret' },
        timeout: 12_345,
      },
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await client.connect()

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Successfully connected'),
      expect.objectContaining({
        authType: 'headers',
        headerNames: ['Authorization', 'X-API-Key'],
        hasUnresolvedEnvRefs: false,
        phase: 'initialize',
        outcome: 'connected',
        timeoutMs: 12_345,
      })
    )
    expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain('do-not-log')
    expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain('also-secret')
  })

  it('keeps the transport on the SSRF guard when no validated address is supplied', () => {
    new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    const guarded = vi.mocked(createGuardedMcpFetch).mock.results.at(-1)?.value
    expect(createGuardedMcpFetch).toHaveBeenCalledWith('https://test.example.com/mcp')
    expect(createPinnedPrivateMcpFetch).not.toHaveBeenCalled()
    expect(vi.mocked(StreamableHTTPClientTransport).mock.calls.at(-1)?.[1]?.fetch).toBe(
      guarded.fetch
    )
  })

  it('pins the transport to a validated private address', () => {
    new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
      resolvedIP: '10.0.0.5',
    })

    const pinned = vi.mocked(createPinnedPrivateMcpFetch).mock.results.at(-1)?.value
    expect(createPinnedPrivateMcpFetch).toHaveBeenCalledWith(
      '10.0.0.5',
      'https://test.example.com/mcp'
    )
    expect(createGuardedMcpFetch).not.toHaveBeenCalled()
    expect(vi.mocked(StreamableHTTPClientTransport).mock.calls.at(-1)?.[1]?.fetch).toBe(
      pinned.fetch
    )
  })

  it('closes the pinned transport Agent when connect fails', async () => {
    mockSdkConnect.mockRejectedValueOnce(new Error('connect boom'))
    const client = new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
      resolvedIP: '93.184.216.34',
    })

    // A failed connect discards the client without a disconnect(), so the Agent
    // must be released on the failure path or its h2 sockets leak.
    await expect(client.connect()).rejects.toThrow()

    expect(mockPinnedClose).toHaveBeenCalledTimes(1)
  })

  it('does not destroy the pinned transport Agent twice when a failed connect is followed by disconnect', async () => {
    mockSdkConnect.mockRejectedValueOnce(new Error('connect boom'))
    const client = new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
      resolvedIP: '93.184.216.34',
    })

    await expect(client.connect()).rejects.toThrow()
    // The caller (e.g. withConnectTimeout) may still call disconnect() afterward;
    // teardown must be idempotent so the Agent is destroyed exactly once.
    await client.disconnect()

    expect(mockPinnedClose).toHaveBeenCalledTimes(1)
  })

  it('does not misclassify rejected static headers as an OAuth authorization flow', async () => {
    mockSdkConnect.mockRejectedValueOnce(new UnauthorizedError('Static token rejected'))
    const client = new McpClient({
      config: {
        ...createConfig(),
        authType: 'headers',
        headers: { Authorization: 'Bearer rejected-static-token' },
      },
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await expect(client.connect()).rejects.toBeInstanceOf(UnauthorizedError)

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to connect'),
      expect.objectContaining({ outcome: 'unauthorized' })
    )
    expect(client.getStatus().lastError).toBe('Authentication failed')
  })

  it('logs tools/list failures without echoed credentials or session identifiers', async () => {
    const secret = 'opaque-tools-list-credential'
    mockSdkListTools.mockRejectedValueOnce(new Error(`Upstream rejected ${secret}`))
    const client = new McpClient({
      config: {
        ...createConfig(),
        authType: 'headers',
        headers: { 'X-Custom-Credential': secret },
      },
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await client.connect()
    await expect(client.listTools()).rejects.toThrow(secret)

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to list tools'),
      expect.objectContaining({
        phase: 'tools/list',
        serverId: 'server-1',
        sessionIdPresent: true,
        error: expect.objectContaining({ name: 'Error' }),
      })
    )
    const logged = JSON.stringify(mockLogger.error.mock.calls)
    expect(logged).not.toContain(secret)
    expect(logged).not.toContain('test-session')
  })

  it('scopes configured headers to the MCP endpoint for OAuth transports', () => {
    const authProvider = {} as unknown as NonNullable<McpClientOptions['authProvider']>
    new McpClient({
      config: {
        ...createConfig(),
        authType: 'oauth',
        headers: { 'X-Sim-Via': 'workflow' },
      },
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
      authProvider,
    })

    expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
      new URL('https://test.example.com/mcp'),
      expect.objectContaining({
        authProvider,
        fetch: expect.any(Function),
      })
    )
    expect(vi.mocked(StreamableHTTPClientTransport).mock.calls.at(-1)?.[1]).not.toHaveProperty(
      'requestInit'
    )
  })
})
