/**
 * @vitest-environment node
 */
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger, mockSdkConnect, mockSdkListTools, mockPinnedClose } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  mockSdkConnect: vi.fn().mockResolvedValue(undefined),
  mockSdkListTools: vi.fn().mockResolvedValue({ tools: [] }),
  mockPinnedClose: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => mockLogger,
}))

vi.mock('@/lib/mcp/pinned-fetch', () => ({
  createPinnedMcpFetch: vi.fn(() => ({ fetch: vi.fn(), close: mockPinnedClose })),
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

vi.mock('@/lib/core/execution-limits', () => ({
  getMaxExecutionTimeout: vi.fn().mockReturnValue(30000),
  DEFAULT_EXECUTION_TIMEOUT_MS: 30000,
}))

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { McpClient } from './client'
import type { McpClientOptions, McpServerConfig } from './types'

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
    vi.clearAllMocks()
    mockSdkConnect.mockResolvedValue(undefined)
    mockSdkListTools.mockResolvedValue({ tools: [] })
    // clearAllMocks resets call history but not implementations; re-establish the
    // default so a per-test override can't bleed into later tests.
    vi.mocked(getMaxExecutionTimeout).mockReturnValue(30_000)
  })

  it('fires onToolsChanged when a notification arrives while connected', async () => {
    const onToolsChanged = vi.fn()

    const client = new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
      onToolsChanged,
    })

    await client.connect()

    expect(capturedNotificationHandler).not.toBeNull()

    await capturedNotificationHandler!()

    expect(onToolsChanged).toHaveBeenCalledTimes(1)
    expect(onToolsChanged).toHaveBeenCalledWith('server-1')
  })

  it('suppresses notifications after disconnect', async () => {
    const onToolsChanged = vi.fn()

    const client = new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
      onToolsChanged,
    })

    await client.connect()
    expect(capturedNotificationHandler).not.toBeNull()

    await client.disconnect()
    await capturedNotificationHandler!()

    expect(onToolsChanged).not.toHaveBeenCalled()
  })

  it('does not register a notification handler when onToolsChanged is not provided', async () => {
    const client = new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await client.connect()

    expect(capturedNotificationHandler).toBeNull()
  })

  it('uses the server connection timeout for the initialize request', async () => {
    const client = new McpClient({
      config: { ...createConfig(), timeout: 12_345 },
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await client.connect()

    expect(mockSdkConnect).toHaveBeenCalledWith(expect.anything(), { timeout: 12_345 })
  })

  it('normalizes invalid connection timeouts before calling the SDK', async () => {
    const client = new McpClient({
      config: { ...createConfig(), timeout: -1 },
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await client.connect()

    expect(mockSdkConnect).toHaveBeenCalledWith(expect.anything(), { timeout: 30_000 })
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
        maxTotalTimeout: 60_000,
        resetTimeoutOnProgress: true,
        onprogress: expect.any(Function),
      })
    )
  })

  it('clamps a configured tools/list timeout to the absolute discovery ceiling', async () => {
    vi.mocked(getMaxExecutionTimeout).mockReturnValue(120_000)
    const client = new McpClient({
      config: { ...createConfig(), timeout: 300_000 },
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await client.connect()
    await client.listTools()

    expect(mockSdkListTools).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ timeout: 60_000, maxTotalTimeout: 60_000 })
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

  it('classifies initialize timeouts in connection diagnostics', async () => {
    mockSdkConnect.mockRejectedValueOnce(new Error('MCP error -32001: Request timed out'))
    const client = new McpClient({
      config: {
        ...createConfig(),
        headers: { Authorization: 'Bearer do-not-log' },
      },
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await expect(client.connect()).rejects.toThrow('Request timed out')

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to connect'),
      expect.objectContaining({
        phase: 'initialize',
        outcome: 'timeout',
        timeoutMs: 30_000,
        error: expect.objectContaining({
          name: 'Error',
        }),
      })
    )
    expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain('do-not-log')
  })

  it('does not log opaque credentials echoed by MCP errors', async () => {
    const secret = 'opaque-credential-without-a-known-prefix'
    mockSdkConnect.mockRejectedValueOnce(new Error(`Upstream rejected ${secret}`))
    const client = new McpClient({
      config: {
        ...createConfig(),
        authType: 'headers',
        headers: { 'X-Custom-Credential': secret },
      },
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
    })

    await expect(client.connect()).rejects.toThrow('Upstream rejected')

    expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(secret)
  })

  it('closes the pinned transport Agent when connect fails', async () => {
    mockSdkConnect.mockRejectedValueOnce(new Error('connect boom'))
    const client = new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
      resolvedIP: '203.0.113.10',
    })

    // A failed connect discards the client without a disconnect(), so the Agent
    // must be released on the failure path or its h2 sockets leak.
    await expect(client.connect()).rejects.toThrow()

    expect(mockPinnedClose).toHaveBeenCalledTimes(1)
  })

  it('closes the pinned transport Agent on disconnect', async () => {
    const client = new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
      resolvedIP: '203.0.113.10',
    })

    await client.connect()
    await client.disconnect()

    expect(mockPinnedClose).toHaveBeenCalledTimes(1)
  })

  it('does not destroy the pinned transport Agent twice when a failed connect is followed by disconnect', async () => {
    mockSdkConnect.mockRejectedValueOnce(new Error('connect boom'))
    const client = new McpClient({
      config: createConfig(),
      securityPolicy: { requireConsent: false, auditLevel: 'basic' },
      resolvedIP: '203.0.113.10',
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

  it('passes configured headers for OAuth transports as well as header auth transports', () => {
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
      {
        authProvider,
        requestInit: { headers: { 'X-Sim-Via': 'workflow' } },
        // The transport fetch is always wrapped for diagnostics (a no-op passthrough
        // under test); it defaults to globalThis.fetch when the server isn't pinned.
        fetch: expect.any(Function),
      }
    )
  })
})
