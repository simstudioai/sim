/**
 * Tests for OAuth connections API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('OAuth Connections API Route', () => {
  const mockGetSession = vi.fn()
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  }
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
  const mockParseProvider = vi.fn()
  const mockEvaluateScopeCoverage = vi.fn()

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
      account: { userId: 'userId', providerId: 'providerId' },
      user: { email: 'email', id: 'id' },
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
    }))

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
    }))

    vi.doMock('jwt-decode', () => ({
      jwtDecode: vi.fn(),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))

    mockParseProvider.mockImplementation((providerId: string) => ({
      baseProvider: providerId.split('-')[0] || providerId,
      featureType: providerId.split('-')[1] || 'default',
    }))

    mockEvaluateScopeCoverage.mockImplementation(
      (_providerId: string, _grantedScopes: string[]) => ({
        canonicalScopes: ['email', 'profile'],
        grantedScopes: ['email', 'profile'],
        missingScopes: [],
        extraScopes: [],
        requiresReauthorization: false,
      })
    )

    vi.doMock('@/lib/oauth/oauth', () => ({
      parseProvider: mockParseProvider,
      evaluateScopeCoverage: mockEvaluateScopeCoverage,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return connections successfully', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    const mockAccounts = [
      {
        id: 'account-1',
        providerId: 'google-email',
        accountId: 'test@example.com',
        scope: 'email profile',
        updatedAt: new Date('2024-01-01'),
        idToken: null,
      },
      {
        id: 'account-2',
        providerId: 'github',
        accountId: 'testuser',
        scope: 'repo',
        updatedAt: new Date('2024-01-02'),
        idToken: null,
      },
    ]

    const mockUserRecord = [{ email: 'user@example.com' }]

    mockDb.select.mockReturnValueOnce(mockDb)
    mockDb.from.mockReturnValueOnce(mockDb)
    mockDb.where.mockResolvedValueOnce(mockAccounts)

    mockDb.select.mockReturnValueOnce(mockDb)
    mockDb.from.mockReturnValueOnce(mockDb)
    mockDb.where.mockReturnValueOnce(mockDb)
    mockDb.limit.mockResolvedValueOnce(mockUserRecord)

    const req = createMockRequest('GET')
    const { GET } = await import('@/app/api/auth/oauth/connections/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.connections).toHaveLength(2)
    expect(data.connections[0]).toMatchObject({
      provider: 'google-email',
      baseProvider: 'google',
      featureType: 'email',
      isConnected: true,
    })
    expect(data.connections[1]).toMatchObject({
      provider: 'github',
      baseProvider: 'github',
      featureType: 'default',
      isConnected: true,
    })
  })

  it('should handle unauthenticated user', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = createMockRequest('GET')
    const { GET } = await import('@/app/api/auth/oauth/connections/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('User not authenticated')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle user with no connections', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockDb.select.mockReturnValueOnce(mockDb)
    mockDb.from.mockReturnValueOnce(mockDb)
    mockDb.where.mockResolvedValueOnce([])

    mockDb.select.mockReturnValueOnce(mockDb)
    mockDb.from.mockReturnValueOnce(mockDb)
    mockDb.where.mockReturnValueOnce(mockDb)
    mockDb.limit.mockResolvedValueOnce([])

    const req = createMockRequest('GET')
    const { GET } = await import('@/app/api/auth/oauth/connections/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.connections).toHaveLength(0)
  })

  it('should handle database error', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockDb.select.mockReturnValueOnce(mockDb)
    mockDb.from.mockReturnValueOnce(mockDb)
    mockDb.where.mockRejectedValueOnce(new Error('Database error'))

    const req = createMockRequest('GET')
    const { GET } = await import('@/app/api/auth/oauth/connections/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('should decode ID token for display name', async () => {
    const { jwtDecode } = await import('jwt-decode')
    const mockJwtDecode = jwtDecode as any

    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    const mockAccounts = [
      {
        id: 'account-1',
        providerId: 'google',
        accountId: 'google-user-id',
        scope: 'email profile',
        updatedAt: new Date('2024-01-01'),
        idToken: 'mock-jwt-token',
      },
    ]

    mockJwtDecode.mockReturnValueOnce({
      email: 'decoded@example.com',
      name: 'Decoded User',
    })

    mockDb.select.mockReturnValueOnce(mockDb)
    mockDb.from.mockReturnValueOnce(mockDb)
    mockDb.where.mockResolvedValueOnce(mockAccounts)

    mockDb.select.mockReturnValueOnce(mockDb)
    mockDb.from.mockReturnValueOnce(mockDb)
    mockDb.where.mockReturnValueOnce(mockDb)
    mockDb.limit.mockResolvedValueOnce([])

    const req = createMockRequest('GET')
    const { GET } = await import('@/app/api/auth/oauth/connections/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.connections[0].accounts[0].name).toBe('decoded@example.com')
  })
})
