/**
 * Tests for OAuth credentials API route
 *
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('OAuth Credentials API Route', () => {
  const mockGetSession = vi.fn()
  const mockParseProvider = vi.fn()
  const mockEvaluateScopeCoverage = vi.fn()
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

  const mockUUID = 'mock-uuid-12345678-90ab-cdef-1234-567890abcdef'

  function createMockRequestWithQuery(method = 'GET', queryParams = ''): NextRequest {
    const url = `http://localhost:3000/api/auth/oauth/credentials${queryParams}`
    return new NextRequest(new URL(url), { method })
  }

  beforeEach(() => {
    vi.resetModules()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue(mockUUID),
    })

    vi.doMock('@/lib/auth', () => ({
      getSession: mockGetSession,
    }))

    vi.doMock('@/lib/oauth/oauth', () => ({
      parseProvider: mockParseProvider,
      evaluateScopeCoverage: mockEvaluateScopeCoverage,
    }))

    vi.doMock('@sim/db', () => ({
      db: mockDb,
    }))

    vi.doMock('@sim/db/schema', () => ({
      account: { userId: 'userId', providerId: 'providerId' },
      user: { email: 'email', id: 'id' },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
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
    }))

    mockEvaluateScopeCoverage.mockImplementation(
      (_providerId: string, grantedScopes: string[]) => ({
        canonicalScopes: grantedScopes,
        grantedScopes,
        missingScopes: [],
        extraScopes: [],
        requiresReauthorization: false,
      })
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return credentials successfully', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockParseProvider.mockReturnValueOnce({
      baseProvider: 'google',
    })

    const mockAccounts = [
      {
        id: 'credential-1',
        userId: 'user-123',
        providerId: 'google-email',
        accountId: 'test@example.com',
        updatedAt: new Date('2024-01-01'),
        idToken: null,
      },
      {
        id: 'credential-2',
        userId: 'user-123',
        providerId: 'google-default',
        accountId: 'user-id',
        updatedAt: new Date('2024-01-02'),
        idToken: null,
      },
    ]

    mockDb.select.mockReturnValueOnce(mockDb)
    mockDb.from.mockReturnValueOnce(mockDb)
    mockDb.where.mockResolvedValueOnce(mockAccounts)

    mockDb.select.mockReturnValueOnce(mockDb)
    mockDb.from.mockReturnValueOnce(mockDb)
    mockDb.where.mockReturnValueOnce(mockDb)
    mockDb.limit.mockResolvedValueOnce([{ email: 'user@example.com' }])

    const req = createMockRequestWithQuery('GET', '?provider=google-email')

    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials).toHaveLength(2)
    expect(data.credentials[0]).toMatchObject({
      id: 'credential-1',
      provider: 'google-email',
      isDefault: false,
    })
    expect(data.credentials[1]).toMatchObject({
      id: 'credential-2',
      provider: 'google-default',
      isDefault: true,
    })
  })

  it('should handle unauthenticated user', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = createMockRequestWithQuery('GET', '?provider=google')

    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('User not authenticated')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle missing provider parameter', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    const req = createMockRequestWithQuery('GET')

    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Provider or credentialId is required')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle no credentials found', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockParseProvider.mockReturnValueOnce({
      baseProvider: 'github',
    })

    mockDb.select.mockReturnValueOnce(mockDb)
    mockDb.from.mockReturnValueOnce(mockDb)
    mockDb.where.mockResolvedValueOnce([])

    const req = createMockRequestWithQuery('GET', '?provider=github')

    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials).toHaveLength(0)
  })

  it('should decode ID token for display name', async () => {
    const { jwtDecode } = await import('jwt-decode')
    const mockJwtDecode = jwtDecode as any

    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockParseProvider.mockReturnValueOnce({
      baseProvider: 'google',
    })

    const mockAccounts = [
      {
        id: 'credential-1',
        userId: 'user-123',
        providerId: 'google-default',
        accountId: 'google-user-id',
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

    const req = createMockRequestWithQuery('GET', '?provider=google')

    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials[0].name).toBe('decoded@example.com')
  })

  it('should handle database error', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockParseProvider.mockReturnValueOnce({
      baseProvider: 'google',
    })

    mockDb.select.mockReturnValueOnce(mockDb)
    mockDb.from.mockReturnValueOnce(mockDb)
    mockDb.where.mockRejectedValueOnce(new Error('Database error'))

    const req = createMockRequestWithQuery('GET', '?provider=google')

    const { GET } = await import('@/app/api/auth/oauth/credentials/route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
