/**
 * Tests for MCP SSE events endpoint
 *
 * @vitest-environment node
 */
import { createMockRequest, mockAuth, mockConsoleLogger } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

mockConsoleLogger()
const auth = mockAuth()

const mockGetUserEntityPermissions = vi.fn()
vi.doMock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.doMock('@/lib/mcp/connection-manager', () => ({
  mcpConnectionManager: null,
}))

vi.doMock('@/lib/mcp/pubsub', () => ({
  mcpPubSub: null,
}))

const { GET } = await import('./route')

describe('MCP Events SSE Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when session is missing', async () => {
    auth.setUnauthenticated()

    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/mcp/events?workspaceId=ws-123'
    )

    const response = await GET(request as any)

    expect(response.status).toBe(401)
    const text = await response.text()
    expect(text).toBe('Unauthorized')
  })

  it('returns 400 when workspaceId is missing', async () => {
    auth.setAuthenticated()

    const request = createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/mcp/events')

    const response = await GET(request as any)

    expect(response.status).toBe(400)
    const text = await response.text()
    expect(text).toBe('Missing workspaceId query parameter')
  })

  it('returns 403 when user lacks workspace access', async () => {
    auth.setAuthenticated()
    mockGetUserEntityPermissions.mockResolvedValue(null)

    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/mcp/events?workspaceId=ws-123'
    )

    const response = await GET(request as any)

    expect(response.status).toBe(403)
    const text = await response.text()
    expect(text).toBe('Access denied to workspace')
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith('user-123', 'workspace', 'ws-123')
  })

  it('returns SSE stream when authorized', async () => {
    auth.setAuthenticated()
    mockGetUserEntityPermissions.mockResolvedValue({ read: true })

    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/mcp/events?workspaceId=ws-123'
    )

    const response = await GET(request as any)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(response.headers.get('Connection')).toBe('keep-alive')
  })
})
