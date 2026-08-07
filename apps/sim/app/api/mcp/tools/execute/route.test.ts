/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCapExecutionTimeoutMs,
  mockDiscoverServerTools,
  mockExecuteTool,
  mockGetExecutionTimeout,
} = vi.hoisted(() => ({
  mockCapExecutionTimeoutMs: vi.fn((_policy: number, requested?: number) => requested ?? 0),
  mockDiscoverServerTools: vi.fn(),
  mockExecuteTool: vi.fn(),
  mockGetExecutionTimeout: vi.fn(() => 0),
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
  capExecutionTimeoutMs: mockCapExecutionTimeoutMs,
  getExecutionTimeout: mockGetExecutionTimeout,
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

  it('returns provenance activated by this MCP transport call', async () => {
    mockDiscoverServerTools.mockImplementationOnce(
      async (
        _userId: string,
        _serverId: string,
        _workspaceId: string,
        _forceRefresh: boolean,
        recordProvenance?: (provenance: unknown) => void
      ) => {
        recordProvenance?.({
          version: 1,
          complete: true,
          entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-mcp-token' }],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        })
        return [{ name: 'example_tool', inputSchema: {} }]
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
      complete: true,
      entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-mcp-token' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(mockDiscoverServerTools.mock.calls[0]?.[4]).toEqual(expect.any(Function))
    expect(mockExecuteTool.mock.calls[0]?.[5]).toEqual(expect.any(Function))
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
    expect(mockDiscoverServerTools.mock.calls[0]?.[4]).toBeUndefined()
    expect(mockExecuteTool.mock.calls[0]?.[5]).toBeUndefined()
  })

  it('preserves MCP error status and message when attaching private provenance', async () => {
    mockExecuteTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: 'text', text: 'Provider rejected the request' }],
    })
    const request = createRequest({
      'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
    })

    const response = await POST(request, {})
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    expect(body).toMatchObject({
      success: false,
      error: 'Provider rejected the request',
      __resolvedSecretTraceProvenance: {
        version: 1,
        complete: true,
        entries: [],
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
    })
  })

  it('attaches private provenance without imposing a second functional response limit', async () => {
    const largeText = 'x'.repeat(10 * 1024 * 1024 + 1)
    mockExecuteTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: largeText }],
    })
    const request = createRequest({
      'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
    })

    const response = await (async () => {
      const responseJsonSpy = vi.spyOn(Response.prototype, 'json')
      try {
        const result = await POST(request, {})
        expect(responseJsonSpy).not.toHaveBeenCalled()
        return result
      } finally {
        responseJsonSpy.mockRestore()
      }
    })()
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(response.ok).toBe(true)
    expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    expect(body.__resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(body).toMatchObject({
      success: true,
      data: {
        success: true,
        output: { content: [{ type: 'text' }] },
      },
    })
    expect(
      (body.data as { output: { content: Array<{ text?: unknown }> } }).output.content[0]?.text
    ).toBe(largeText)
  })

  it('uses the remaining workflow deadline for trusted internal tool calls', async () => {
    const request = createRequest({
      'x-sim-execution-deadline-ms': String(Date.now() + 10_000),
    })

    const response = await POST(request, {})

    expect(response.status).toBe(200)
    expect(mockGetExecutionTimeout).toHaveBeenCalledWith('pro', 'async', undefined)
    expect(mockCapExecutionTimeoutMs).toHaveBeenCalledWith(0, expect.any(Number))
    const remainingMs = mockCapExecutionTimeoutMs.mock.calls.at(-1)?.[1]
    expect(remainingMs).toBeGreaterThan(0)
    expect(remainingMs).toBeLessThanOrEqual(10_000)
  })

  it('ignores the internal deadline header for session callers', async () => {
    const request = createRequest({
      'x-test-session': 'true',
      'x-sim-execution-deadline-ms': String(Date.now() + 10_000),
    })

    const response = await POST(request, {})

    expect(response.status).toBe(200)
    expect(mockGetExecutionTimeout).toHaveBeenCalledWith('pro', 'sync')
    expect(mockCapExecutionTimeoutMs).not.toHaveBeenCalled()
  })
})
