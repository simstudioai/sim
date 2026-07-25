/**
 * @vitest-environment node
 */
import { createMockRequest, loggerMock } from '@sim/testing'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockClientOptions,
  mockConnect,
  mockDetectMcpAuthType,
  mockDisconnect,
  mockListTools,
  mockResolveMcpConfigEnvVars,
  mockValidateMcpServerSsrf,
  MockMcpSsrfError,
} = vi.hoisted(() => ({
  mockClientOptions: vi.fn(),
  mockConnect: vi.fn(),
  mockDetectMcpAuthType: vi.fn(),
  mockDisconnect: vi.fn(),
  mockListTools: vi.fn(),
  mockResolveMcpConfigEnvVars: vi.fn(),
  mockValidateMcpServerSsrf: vi.fn(),
  MockMcpSsrfError: class extends Error {},
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

vi.mock('@/lib/mcp/client', () => ({
  McpClient: class {
    constructor(options: unknown) {
      mockClientOptions(options)
    }

    static getVersionInfo() {
      return { preferred: '2025-06-18', supported: ['2025-06-18'] }
    }

    connect = mockConnect
    disconnect = mockDisconnect
    listTools = mockListTools

    getNegotiatedVersion() {
      return '2025-06-18'
    }
  },
}))

vi.mock('@/lib/mcp/domain-check', () => ({
  McpDnsResolutionError: class extends Error {},
  McpDomainNotAllowedError: class extends Error {},
  McpSsrfError: MockMcpSsrfError,
  validateMcpDomain: vi.fn(),
  validateMcpServerSsrf: mockValidateMcpServerSsrf,
}))

vi.mock('@/lib/mcp/middleware', () => ({
  mcpBodyReadErrorResponse: vi.fn(() => null),
  readMcpJsonBodyWithLimit: (request: NextRequest) => request.json(),
  withMcpAuth:
    () =>
    (
      handler: (
        request: NextRequest,
        context: { userId: string; workspaceId: string; requestId: string }
      ) => Promise<Response>
    ) =>
    (request: NextRequest) =>
      handler(request, {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        requestId: 'request-1',
      }),
}))

vi.mock('@/lib/mcp/oauth', () => ({
  detectMcpAuthType: mockDetectMcpAuthType,
}))

vi.mock('@/lib/mcp/resolve-config', () => ({
  resolveMcpConfigEnvVars: mockResolveMcpConfigEnvVars,
}))

import { POST } from '@/app/api/mcp/servers/test-connection/route'

const mockLogger = vi.mocked(loggerMock.createLogger).mock.results.at(-1)?.value

function createTestRequest(headers: Record<string, string> = {}) {
  return createMockRequest(
    'POST',
    {
      name: 'Dual Auth Server',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers,
      timeout: 10000,
    },
    {},
    'http://localhost/api/mcp/servers/test-connection'
  )
}

describe('MCP server test-connection route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDetectMcpAuthType.mockResolvedValue('oauth')
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    mockResolveMcpConfigEnvVars.mockImplementation(async (config: unknown) => ({
      config,
      missingVars: [],
    }))
    mockConnect.mockResolvedValue(undefined)
    mockListTools.mockResolvedValue([])
    mockDisconnect.mockResolvedValue(undefined)
  })

  it('tests configured bearer headers before treating OAuth discovery as mandatory', async () => {
    const response = await POST(createTestRequest({ Authorization: 'Bearer static-api-token' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual(
      expect.objectContaining({ success: true, authType: 'headers', toolCount: 0 })
    )
    expect(mockDetectMcpAuthType).not.toHaveBeenCalled()
    expect(mockClientOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          headers: { Authorization: 'Bearer static-api-token' },
        }),
      })
    )
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  it('returns a header-auth failure when the configured token is rejected', async () => {
    mockConnect.mockRejectedValueOnce(new Error('HTTP 401: Unauthorized'))

    const response = await POST(createTestRequest({ Authorization: 'Bearer invalid-static-token' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.data).toEqual(
      expect.objectContaining({
        success: false,
        authType: 'headers',
        error: 'HTTP 401: Unauthorized',
      })
    )
    expect(mockDetectMcpAuthType).not.toHaveBeenCalled()
    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockDisconnect).toHaveBeenCalledTimes(1)
  })

  it('does not expose configured credentials echoed by an upstream error', async () => {
    const token = 'opaque-static-token'
    mockConnect.mockRejectedValueOnce(new Error(`Upstream rejected ${token}`))

    const response = await POST(createTestRequest({ Authorization: `Bearer ${token}` }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.data).toEqual(
      expect.objectContaining({ success: false, authType: 'headers', error: 'Connection failed' })
    )
    expect(mockLogger).toBeDefined()
    expect(JSON.stringify(mockLogger?.warn.mock.calls)).not.toContain(token)
  })

  it('preserves OAuth discovery when no static headers are configured', async () => {
    const response = await POST(createTestRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual(
      expect.objectContaining({ success: false, authRequired: true, authType: 'oauth' })
    )
    expect(mockDetectMcpAuthType).toHaveBeenCalledWith('https://example.com/mcp', '203.0.113.10')
    expect(mockClientOptions).not.toHaveBeenCalled()
  })

  it('preserves OAuth discovery when only supplemental headers are configured', async () => {
    const response = await POST(createTestRequest({ 'X-Sim-Via': 'workflow' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual(
      expect.objectContaining({ success: false, authRequired: true, authType: 'oauth' })
    )
    expect(mockDetectMcpAuthType).toHaveBeenCalledWith('https://example.com/mcp', '203.0.113.10')
    expect(mockClientOptions).not.toHaveBeenCalled()
  })

  it('blocks an env-resolved private URL before forwarding configured credentials', async () => {
    const token = 'private-static-token'
    mockResolveMcpConfigEnvVars.mockResolvedValueOnce({
      config: {
        id: 'test-request-1',
        name: 'Dual Auth Server',
        transport: 'streamable-http',
        url: 'http://127.0.0.1/mcp',
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
        retries: 1,
        enabled: true,
      },
      missingVars: [],
    })
    mockValidateMcpServerSsrf.mockImplementation(async (url: string) => {
      if (url === 'http://127.0.0.1/mcp') {
        throw new MockMcpSsrfError('Private network targets are not allowed')
      }
      return '203.0.113.10'
    })

    const response = await POST(createTestRequest({ Authorization: `Bearer ${token}` }))
    const responseText = await response.text()

    expect(response.status).toBe(403)
    expect(responseText).not.toContain(token)
    expect(mockValidateMcpServerSsrf).toHaveBeenNthCalledWith(2, 'http://127.0.0.1/mcp')
    expect(mockClientOptions).not.toHaveBeenCalled()
    expect(mockDetectMcpAuthType).not.toHaveBeenCalled()
  })
})
