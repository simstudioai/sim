/**
 * Tests for MCP SSE events endpoint
 *
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetUserEntityPermissions } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/mcp/connection-manager', () => ({
  mcpConnectionManager: null,
}))

vi.mock('@/lib/mcp/pubsub', () => ({
  mcpPubSub: null,
}))

import { GET } from './route'

const defaultMockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
}

describe('MCP Events SSE Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when session is missing', async () => {
    mockGetSession.mockResolvedValue(null)

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
    mockGetSession.mockResolvedValue({ user: defaultMockUser })

    const request = createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/mcp/events')

    const response = await GET(request as any)

    expect(response.status).toBe(400)
    const text = await response.text()
    expect(text).toBe('Missing workspaceId query parameter')
  })

  it('returns 403 when user lacks workspace access', async () => {
    mockGetSession.mockResolvedValue({ user: defaultMockUser })
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
    mockGetSession.mockResolvedValue({ user: defaultMockUser })
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
