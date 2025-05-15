/**
 * Tests for Subscription Transfer API
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Subscription Transfer API Routes', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
  }

  const mockSubscription = {
    id: 'sub-123',
    plan: 'enterprise',
    status: 'active',
    seats: 5,
    referenceId: 'user-123',
    metadata: {
      perSeatAllowance: 100,
      totalAllowance: 500,
      updatedAt: '2023-01-01T00:00:00.000Z',
    },
  }

  const mockOrganization = {
    id: 'org-456',
    name: 'Test Organization',
    slug: 'test-org',
  }

  const mockAdminMember = {
    id: 'member-123',
    userId: 'user-123',
    organizationId: 'org-456',
    role: 'admin',
  }

  const mockRegularMember = {
    id: 'member-456',
    userId: 'user-123',
    organizationId: 'org-456',
    role: 'member',
  }

  const mockDb = {
    select: vi.fn(),
    update: vi.fn(),
  }

  const mockEq = vi.fn().mockImplementation((field, value) => ({ field, value, type: 'eq' }))
  const mockAnd = vi.fn().mockImplementation((...conditions) => ({
    conditions,
    type: 'and',
  }))

  beforeEach(() => {
    vi.resetModules()

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: mockUser,
      }),
    }))

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))

    vi.doMock('drizzle-orm', () => ({
      eq: mockEq,
      and: mockAnd,
    }))

    vi.doMock('@/db', () => ({
      db: mockDb,
    }))

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: vi.fn().mockResolvedValue([mockSubscription]),
    })

    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ affected: 1 }]),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('POST handler', () => {
    it('should successfully transfer a personal subscription to an organization', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: {
            ...mockUser,
            id: 'user-123',
          },
        }),
      }))

      vi.doMock('@/db/schema', () => ({
        subscription: { id: 'id', referenceId: 'referenceId' },
        organization: { id: 'id' },
        member: { userId: 'userId', organizationId: 'organizationId', role: 'role' },
      }))

      const mockSubscriptionWithReferenceId = {
        ...mockSubscription,
        referenceId: 'user-123',
      }

      mockDb.select.mockImplementation(() => {
        return {
          from: () => ({
            where: () => {
              if (mockDb.select.mock.calls.length === 1) {
                return Promise.resolve([mockSubscriptionWithReferenceId])
              } else if (mockDb.select.mock.calls.length === 2) {
                return Promise.resolve([mockOrganization])
              } else {
                return Promise.resolve([mockAdminMember])
              }
            },
          }),
        }
      })

      mockDb.update.mockReturnValue({
        set: () => ({
          where: () => Promise.resolve({ affected: 1 }),
        }),
      })

      const req = createMockRequest('POST', {
        organizationId: 'org-456',
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })

      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('success', true)
      expect(data).toHaveProperty('message', 'Subscription transferred successfully')
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('should test behavior when subscription not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn().mockResolvedValue([]),
      })

      const req = createMockRequest('POST', {
        organizationId: 'org-456',
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error', 'Unauthorized - subscription does not belong to user')
    })

    it('should test behavior when organization not found', async () => {
      const mockSelectImpl = vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          then: vi.fn().mockResolvedValue([mockSubscription]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          then: vi.fn().mockResolvedValue([]),
        })

      mockDb.select.mockImplementation(mockSelectImpl)

      const req = createMockRequest('POST', {
        organizationId: 'org-456',
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error', 'Unauthorized - subscription does not belong to user')
    })

    it('should reject transfer if user is not the subscription owner', async () => {
      const differentOwnerSubscription = {
        ...mockSubscription,
        referenceId: 'different-user-123',
      }

      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn().mockResolvedValue([differentOwnerSubscription]),
      })

      const req = createMockRequest('POST', {
        organizationId: 'org-456',
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error', 'Unauthorized - subscription does not belong to user')
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('should reject non-personal transfer if user is not admin of organization', async () => {
      const orgOwnedSubscription = {
        ...mockSubscription,
        referenceId: 'other-org-789',
      }

      const mockSelectImpl = vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          then: vi.fn().mockResolvedValue([orgOwnedSubscription]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          then: vi.fn().mockResolvedValue([mockOrganization]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          then: vi.fn().mockResolvedValue([mockRegularMember]),
        })

      mockDb.select.mockImplementation(mockSelectImpl)

      const req = createMockRequest('POST', {
        organizationId: 'org-456',
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error', 'Unauthorized - subscription does not belong to user')
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('should reject invalid request parameters', async () => {
      const req = createMockRequest('POST', {})

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Invalid request parameters')
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('should handle authentication error', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      const req = createMockRequest('POST', {
        organizationId: 'org-456',
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('should handle internal server error', async () => {
      mockDb.select.mockImplementation(() => {
        throw new Error('Database error')
      })

      const req = createMockRequest('POST', {
        organizationId: 'org-456',
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toHaveProperty('error', 'Failed to transfer subscription')
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })
})
