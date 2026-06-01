/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
          connect: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          getServerVersion: vi.fn().mockReturnValue('2025-06-18'),
          getServerCapabilities: vi.fn().mockReturnValue({ tools: { listChanged: true } }),
          setNotificationHandler: vi
            .fn()
            .mockImplementation((_schema: unknown, handler: () => Promise<void>) => {
              capturedNotificationHandler = handler
            }),
          listTools: vi.fn().mockResolvedValue({ tools: [] }),
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
      }
    )
  })
})
