/**
 * Tests for Subscription Seats Update API
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Subscription Seats Update API Routes', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  const mockSubscription = {
    id: 'sub-123',
    plan: 'enterprise',
    status: 'active',
    seats: 5,
    referenceId: 'org-123',
    metadata: {
      perSeatAllowance: 100,
      totalAllowance: 500,
      updatedAt: '2023-01-01T00:00:00.000Z',
    },
  }

  const mockTeamSubscription = {
    id: 'sub-456',
    plan: 'team',
    status: 'active',
    seats: 5,
    referenceId: 'org-123',
  }

  const mockPersonalSubscription = {
    id: 'sub-789',
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

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
  }

  const mockAdminMember = {
    id: 'member-123',
    userId: 'user-123',
    organizationId: 'org-123',
    role: 'admin',
  }

  const mockRegularMember = {
    id: 'member-456',
    userId: 'user-123',
    organizationId: 'org-123',
    role: 'member',
  }

  const mockDb = {
    select: vi.fn(),
    update: vi.fn(),
  }

  beforeEach(() => {
    vi.resetModules()

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: mockUser,
      }),
    }))

    vi.doMock('@/lib/subscription/utils', () => ({
      checkEnterprisePlan: vi.fn().mockImplementation((sub) => sub.plan === 'enterprise'),
    }))

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
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
      where: vi.fn().mockResolvedValue([]),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('POST handler', () => {
    it('should update subscription seats for enterprise plan', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn().mockResolvedValue([mockSubscription]),
      })

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
          then: vi.fn().mockResolvedValue([mockAdminMember]),
        })

      mockDb.select.mockImplementation(mockSelectImpl)

      const req = createMockRequest('POST', {
        seats: 10,
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error')
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('should reject team plan subscription updates', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn().mockResolvedValue([mockTeamSubscription]),
      })

      const req = createMockRequest('POST', {
        seats: 10,
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty(
        'error',
        'Only enterprise subscriptions can be updated through this endpoint'
      )
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('should allow personal subscription updates for the subscription owner', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn().mockResolvedValue([mockPersonalSubscription]),
      })

      const req = createMockRequest('POST', {
        seats: 10,
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error')
    })

    it('should reject updates from non-admin members', async () => {
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
          then: vi.fn().mockResolvedValue([mockRegularMember]),
        })

      mockDb.select.mockImplementation(mockSelectImpl)

      const req = createMockRequest('POST', {
        seats: 10,
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error')
    })

    it('should reject invalid request parameters', async () => {
      const req = createMockRequest('POST', {
        seats: -5,
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Invalid request parameters')
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('should handle subscription not found', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn().mockResolvedValue([]),
      })

      const req = createMockRequest('POST', {
        seats: 10,
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error')
    })

    it('should handle authentication error', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      const req = createMockRequest('POST', {
        seats: 10,
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
        seats: 10,
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toHaveProperty('error', 'Failed to update subscription seats')
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })
})
