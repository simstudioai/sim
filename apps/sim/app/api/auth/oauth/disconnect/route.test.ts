/**
 * Tests for OAuth disconnect API route
 *
 * @vitest-environment node
 */
import {
  auditMock,
  authMock,
  authMockFns,
  createMockRequest,
  requestUtilsMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockSelectChain, mockLogger, mockSyncAllWebhooksForCredentialSet } = vi.hoisted(
  () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    }
    const db = {
      delete: vi.fn().mockReturnThis(),
      where: vi.fn(),
      select: vi.fn().mockReturnValue(selectChain),
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
      mockDb: db,
      mockSelectChain: selectChain,
      mockLogger: logger,
      mockSyncAllWebhooksForCredentialSet: vi.fn().mockResolvedValue({}),
    }
  }
)

vi.mock('@/lib/auth', () => authMock)

vi.mock('@sim/db', () => ({
  db: mockDb,
}))

vi.mock('@sim/db/schema', () => schemaMock)

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  like: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'like' })),
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))

vi.mock('@/lib/core/utils/request', () => requestUtilsMock)

vi.mock('@/lib/webhooks/utils.server', () => ({
  syncAllWebhooksForCredentialSet: mockSyncAllWebhooksForCredentialSet,
}))

vi.mock('@/lib/audit/log', () => auditMock)

import { POST } from '@/app/api/auth/oauth/disconnect/route'

describe('OAuth Disconnect API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockDb.delete.mockReturnThis()
    mockSelectChain.from.mockReturnThis()
    mockSelectChain.innerJoin.mockReturnThis()
    mockSelectChain.where.mockResolvedValue([])
  })

  it('should disconnect provider successfully', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockDb.delete.mockReturnValueOnce(mockDb)
    mockDb.where.mockResolvedValueOnce(undefined)

    const req = createMockRequest('POST', {
      provider: 'google',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockLogger.info).toHaveBeenCalled()
  })

  it('should disconnect specific provider ID successfully', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockDb.delete.mockReturnValueOnce(mockDb)
    mockDb.where.mockResolvedValueOnce(undefined)

    const req = createMockRequest('POST', {
      provider: 'google',
      providerId: 'google-email',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockLogger.info).toHaveBeenCalled()
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
    expect(mockLogger.warn).toHaveBeenCalled()
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
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle database error', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-123' },
    })

    mockDb.delete.mockReturnValueOnce(mockDb)
    mockDb.where.mockRejectedValueOnce(new Error('Database error'))

    const req = createMockRequest('POST', {
      provider: 'google',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
