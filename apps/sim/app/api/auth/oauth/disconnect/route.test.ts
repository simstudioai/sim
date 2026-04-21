/**
 * Tests for OAuth disconnect API route
 *
 * @vitest-environment node
 */
import {
  auditMock,
  authMockFns,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSyncAllWebhooksForCredentialSet } = vi.hoisted(() => ({
  mockSyncAllWebhooksForCredentialSet: vi.fn().mockResolvedValue({}),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/webhooks/utils.server', () => ({
  syncAllWebhooksForCredentialSet: mockSyncAllWebhooksForCredentialSet,
}))

vi.mock('@/lib/audit/log', () => auditMock)

import { POST } from '@/app/api/auth/oauth/disconnect/route'

describe('OAuth Disconnect API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.where.mockResolvedValue([])
  })

  it('should disconnect provider successfully', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    const req = createMockRequest('POST', {
      provider: 'google',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('should disconnect specific provider ID successfully', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    const req = createMockRequest('POST', {
      provider: 'google',
      providerId: 'google-email',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('should handle unauthenticated user', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const req = createMockRequest('POST', {
      provider: 'google',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('User not authenticated')
  })

  it('should handle missing provider', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    const req = createMockRequest('POST', {})

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Provider is required')
  })

  it('should handle database error', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    dbChainMockFns.where.mockRejectedValueOnce(new Error('Database error'))

    const req = createMockRequest('POST', {
      provider: 'google',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
  })
})
