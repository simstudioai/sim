/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => loggerMock)

/**
 * Capture the notification handler registered via `client.setNotificationHandler()`.
 * This lets us simulate the MCP SDK delivering a `tools/list_changed` notification.
 */
let capturedNotificationHandler: (() => Promise<void>) | null = null

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
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
  })),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({
    onclose: null,
    sessionId: 'test-session',
  })),
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ToolListChangedNotificationSchema: { method: 'notifications/tools/list_changed' },
}))

vi.mock('@/lib/core/execution-limits', () => ({
  getMaxExecutionTimeout: vi.fn().mockReturnValue(30000),
}))

import { McpClient } from './client'
import type { McpServerConfig } from './types'

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
})
