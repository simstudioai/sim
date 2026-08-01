/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDiscoverServerTools, mockExecuteTool } = vi.hoisted(() => ({
  mockDiscoverServerTools: vi.fn(),
  mockExecuteTool: vi.fn(),
}))

vi.mock('@/lib/mcp/middleware', () => ({
  withMcpAuth:
    () =>
    (
      handler: (
        request: NextRequest,
        context: {
          userId: string
          workspaceId: string
          requestId: string
          authType: 'internal_jwt' | 'session'
        },
        routeContext: { params: Promise<Record<string, string>> }
      ) => Promise<Response>
    ) =>
    (request: NextRequest) =>
      handler(
        request,
        {
          userId: 'user-1',
          workspaceId: 'workspace-1',
          requestId: 'request-1',
          authType: request.headers.has('x-test-session') ? 'session' : 'internal_jwt',
        },
        { params: Promise.resolve({}) }
      ),
  readMcpJsonBodyWithLimit: (request: NextRequest) => request.json(),
  mcpBodyReadErrorResponse: () => null,
}))

vi.mock('@/lib/mcp/service', () => ({
  mcpService: {
    discoverServerTools: mockDiscoverServerTools,
    executeTool: mockExecuteTool,
  },
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  requireBillingAttributionHeader: () => ({ payerSubscription: { plan: 'pro' } }),
  resolveBillingAttribution: async () => ({ payerSubscription: { plan: 'pro' } }),
}))

vi.mock('@/lib/core/execution-limits', () => ({
  DEFAULT_EXECUTION_TIMEOUT_MS: 30_000,
  getExecutionTimeout: () => 0,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: async () => {},
  McpToolsNotAllowedError: class McpToolsNotAllowedError extends Error {},
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { mcpToolExecuted: vi.fn() },
}))

import { POST } from '@/app/api/mcp/tools/execute/route'

const URL = 'http://localhost/api/mcp/tools/execute'
const REQUEST_BODY = {
  workspaceId: 'workspace-1',
  serverId: 'server-1',
  toolName: 'example_tool',
  arguments: {},
}

function createRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(REQUEST_BODY),
  })
}

describe('MCP tool execution private secret provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDiscoverServerTools.mockResolvedValue([{ name: 'example_tool', inputSchema: {} }])
    mockExecuteTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
  })

  it('returns scoped encrypted provenance only to an authenticated internal caller', async () => {
    mockDiscoverServerTools.mockImplementationOnce(
      async (
        _userId: string,
        _serverId: string,
        _workspaceId: string,
        _forceRefresh: boolean,
        report: (value: unknown) => void
      ) => {
        report({
          version: 1,
          complete: false,
          entries: [{ name: 'OLD_TOKEN', encryptedValue: 'encrypted-v1' }],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        })
        return [{ name: 'example_tool', inputSchema: {} }]
      }
    )
    mockExecuteTool.mockImplementationOnce(
      async (
        _userId: string,
        _serverId: string,
        _toolCall: unknown,
        _workspaceId: string,
        _headers: unknown,
        report: (value: unknown) => void
      ) => {
        report({
          version: 1,
          complete: true,
          entries: [{ name: 'NEW_TOKEN', encryptedValue: 'encrypted-v2' }],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        })
        return { content: [{ type: 'text', text: 'ok' }] }
      }
    )
    const request = createRequest({
      'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
    })

    const response = await POST(request, {})
    const body = (await response.json()) as Record<string, unknown>

    expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    expect(body.__resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: false,
      entries: [
        { name: 'OLD_TOKEN', encryptedValue: 'encrypted-v1' },
        { name: 'NEW_TOKEN', encryptedValue: 'encrypted-v2' },
      ],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  it('does not expose private provenance metadata to a session caller', async () => {
    const request = createRequest({
      'x-test-session': 'true',
      'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
    })

    const response = await POST(request, {})
    const body = (await response.json()) as Record<string, unknown>

    expect(response.headers.has('x-sim-private-tool-metadata')).toBe(false)
    expect(body).not.toHaveProperty('__resolvedSecretTraceProvenance')
  })

  it('fails closed when attaching provenance would exceed the response budget', async () => {
    mockExecuteTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'x'.repeat(10 * 1024 * 1024) }],
    })
    const request = createRequest({
      'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
    })

    const response = await POST(request, {})
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(500)
    expect(response.ok).toBe(false)
    expect(body).toEqual({
      success: false,
      error: 'Internal MCP response could not be verified',
      __resolvedSecretTraceProvenance: {
        version: 1,
        complete: false,
        entries: [],
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
    })
  })
})
