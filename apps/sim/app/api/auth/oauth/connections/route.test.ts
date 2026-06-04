/**
 * Tests for OAuth connections API route
 *
 * @vitest-environment node
 */
import {
  authMockFns,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseProvider, mockJwtDecode, mockEq } = vi.hoisted(() => ({
  mockParseProvider: vi.fn(),
  mockJwtDecode: vi.fn(),
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
}))

vi.mock('@sim/db', () => ({
  ...dbChainMock,
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

vi.mock('@/lib/oauth/utils', () => ({
  parseProvider: mockParseProvider,
}))

import { GET } from '@/app/api/auth/oauth/connections/route'

describe('OAuth Connections API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()

    mockParseProvider.mockImplementation((providerId: string) => ({
      baseProvider: providerId.split('-')[0] || providerId,
      featureType: providerId.split('-')[1] || 'default',
    }))
  })

  it('should return connections successfully', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
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

    dbChainMockFns.where.mockResolvedValueOnce(mockAccounts)
    dbChainMockFns.limit.mockResolvedValueOnce(mockUserRecord)

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
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const req = createMockRequest('GET')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('User not authenticated')
  })

  it('should handle user with no connections', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    dbChainMockFns.where.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const req = createMockRequest('GET')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.connections).toHaveLength(0)
  })

  it('should handle database error', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    dbChainMockFns.where.mockRejectedValueOnce(new Error('Database error'))

    const req = createMockRequest('GET')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
  })

  it('should decode ID token for display name', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
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

    dbChainMockFns.where.mockResolvedValueOnce(mockAccounts)
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const req = createMockRequest('GET')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.connections[0].accounts[0].name).toBe('decoded@example.com')
  })
})
