/**
 * Tests for OAuth disconnect API route
 *
 * @vitest-environment node
 */
import {
  auditMock,
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRevokeQuickBooksToken } = vi.hoisted(() => ({
  mockRevokeQuickBooksToken: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/oauth/quickbooks', () => ({
  revokeQuickBooksToken: mockRevokeQuickBooksToken,
}))

import { POST } from '@/app/api/auth/oauth/disconnect/route'

describe('OAuth Disconnect API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.where.mockResolvedValue([])
    mockRevokeQuickBooksToken.mockResolvedValue(undefined)
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

  it('revokes the QuickBooks refresh token before deleting the local account', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })
    dbChainMockFns.where
      .mockResolvedValueOnce([
        {
          id: 'account-1',
          providerId: 'quickbooks',
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      ])
      .mockResolvedValueOnce([])

    const response = await POST(
      createMockRequest('POST', {
        provider: 'quickbooks',
        providerId: 'quickbooks',
        accountId: 'account-1',
      })
    )

    expect(response.status).toBe(200)
    expect(mockRevokeQuickBooksToken).toHaveBeenCalledWith('refresh-token')
    expect(dbChainMockFns.delete).toHaveBeenCalled()
    expect(mockRevokeQuickBooksToken.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.delete.mock.invocationCallOrder[0]
    )
  })

  it('falls back to the QuickBooks access token when no refresh token is stored', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })
    dbChainMockFns.where
      .mockResolvedValueOnce([
        {
          id: 'account-1',
          providerId: 'quickbooks',
          accessToken: 'access-token',
          refreshToken: null,
        },
      ])
      .mockResolvedValueOnce([])

    const response = await POST(
      createMockRequest('POST', {
        provider: 'quickbooks',
        providerId: 'quickbooks',
        accountId: 'account-1',
      })
    )

    expect(response.status).toBe(200)
    expect(mockRevokeQuickBooksToken).toHaveBeenCalledWith('access-token')
  })

  it('keeps QuickBooks credentials locally when Intuit revocation fails', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })
    dbChainMockFns.where.mockResolvedValueOnce([
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
    ])
    mockRevokeQuickBooksToken.mockRejectedValueOnce(new Error('Intuit unavailable'))

    const response = await POST(
      createMockRequest('POST', {
        provider: 'quickbooks',
        providerId: 'quickbooks',
        accountId: 'account-1',
      })
    )
    const data = await response.json()

    expect(response.status).toBe(502)
    expect(data.error).toBe('Unable to revoke QuickBooks access. Please try again.')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('removes a tokenless QuickBooks account without calling Intuit', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })
    dbChainMockFns.where
      .mockResolvedValueOnce([
        {
          id: 'account-1',
          providerId: 'quickbooks',
          accessToken: null,
          refreshToken: null,
        },
      ])
      .mockResolvedValueOnce([])

    const response = await POST(
      createMockRequest('POST', {
        provider: 'quickbooks',
        providerId: 'quickbooks',
        accountId: 'account-1',
      })
    )

    expect(response.status).toBe(200)
    expect(mockRevokeQuickBooksToken).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).toHaveBeenCalled()
  })

  it('does not revoke tokens for non-QuickBooks providers', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })
    dbChainMockFns.where
      .mockResolvedValueOnce([
        {
          id: 'account-1',
          providerId: 'google-email',
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      ])
      .mockResolvedValueOnce([])

    const response = await POST(
      createMockRequest('POST', {
        provider: 'google',
        providerId: 'google-email',
        accountId: 'account-1',
      })
    )

    expect(response.status).toBe(200)
    expect(mockRevokeQuickBooksToken).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).toHaveBeenCalled()
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
