/**
 * Tests for OAuth connections API route
 *
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockDb,
  mockLogger,
  mockParseProvider,
  mockEvaluateScopeCoverage,
  mockJwtDecode,
  mockEq,
} = vi.hoisted(() => {
  const db = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  }
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  return {
    mockGetSession: vi.fn(),
    mockDb: db,
    mockLogger: logger,
    mockParseProvider: vi.fn(),
    mockEvaluateScopeCoverage: vi.fn(),
    mockJwtDecode: vi.fn(),
    mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  }
})

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@sim/db', () => ({
  db: mockDb,
  account: { userId: 'userId', providerId: 'providerId' },
  user: { email: 'email', id: 'id' },
  eq: mockEq,
}))

vi.mock('drizzle-orm', () => ({
  eq: mockEq,
}))

vi.mock('jwt-decode', () => ({
  jwtDecode: mockJwtDecode,
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))

vi.mock('@/lib/oauth/utils', () => ({
  parseProvider: mockParseProvider,
  evaluateScopeCoverage: mockEvaluateScopeCoverage,
}))

import { GET } from '@/app/api/auth/oauth/connections/route'

describe('OAuth Connections API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockDb.select.mockReturnThis()
    mockDb.from.mockReturnThis()
    mockDb.where.mockReturnThis()

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

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('should decode ID token for display name', async () => {
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

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.connections[0].accounts[0].name).toBe('decoded@example.com')
  })
})
