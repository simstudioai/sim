/**
 * Tests for OAuth disconnect API route
 *
 * @vitest-environment node
 */
import { createMockLogger, createMockRequest } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('OAuth Disconnect API Route', () => {
  const mockGetSession = vi.fn()
  const mockSelectChain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  }
  const mockDb = {
    delete: vi.fn().mockReturnThis(),
    where: vi.fn(),
    select: vi.fn().mockReturnValue(mockSelectChain),
  }
  const mockLogger = createMockLogger()
  const mockSyncAllWebhooksForCredentialSet = vi.fn().mockResolvedValue({})

  const mockUUID = 'mock-uuid-12345678-90ab-cdef-1234-567890abcdef'

  beforeEach(() => {
    vi.resetModules()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue(mockUUID),
    })

    vi.doMock('@/lib/auth', () => ({
      getSession: mockGetSession,
    }))

    vi.doMock('@sim/db', () => ({
      db: mockDb,
    }))

    vi.doMock('@sim/db/schema', () => ({
      account: { userId: 'userId', providerId: 'providerId' },
      credentialSetMember: {
        id: 'id',
        credentialSetId: 'credentialSetId',
        userId: 'userId',
        status: 'status',
      },
      credentialSet: { id: 'id', providerId: 'providerId' },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      like: vi.fn((field, value) => ({ field, value, type: 'like' })),
      or: vi.fn((...conditions) => ({ conditions, type: 'or' })),
    }))

    vi.doMock('@sim/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))

    vi.doMock('@/lib/core/utils/request', () => ({
      generateRequestId: vi.fn().mockReturnValue('test-request-id'),
    }))

    vi.doMock('@/lib/webhooks/utils.server', () => ({
      syncAllWebhooksForCredentialSet: mockSyncAllWebhooksForCredentialSet,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should disconnect provider successfully', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockDb.delete.mockReturnValueOnce(mockDb)
    mockDb.where.mockResolvedValueOnce(undefined)

    const req = createMockRequest('POST', {
      provider: 'google',
    })

    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockLogger.info).toHaveBeenCalled()
  })

  it('should disconnect specific provider ID successfully', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockDb.delete.mockReturnValueOnce(mockDb)
    mockDb.where.mockResolvedValueOnce(undefined)

    const req = createMockRequest('POST', {
      provider: 'google',
      providerId: 'google-email',
    })

    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockLogger.info).toHaveBeenCalled()
  })

  it('should handle unauthenticated user', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = createMockRequest('POST', {
      provider: 'google',
    })

    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('User not authenticated')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle missing provider', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    const req = createMockRequest('POST', {})

    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Provider is required')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle database error', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockDb.delete.mockReturnValueOnce(mockDb)
    mockDb.where.mockRejectedValueOnce(new Error('Database error'))

    const req = createMockRequest('POST', {
      provider: 'google',
    })

    const { POST } = await import('@/app/api/auth/oauth/disconnect/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
