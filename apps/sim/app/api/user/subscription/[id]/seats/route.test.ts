/**
 * Tests for Subscription Seats Update API
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockDb,
  mockLogger,
  mockPersonalSubscription,
  mockRegularMember,
  mockSubscription,
  mockTeamSubscription,
  mockUser,
} from '@/app/api/__test-utils__/utils'

describe('Subscription Seats Update API Routes', () => {
  beforeEach(() => {
    vi.resetModules()

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: mockUser,
      }),
    }))

    vi.doMock('@/lib/subscription/utils', () => ({
      checkEnterprisePlan: vi.fn().mockReturnValue(true),
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

    const mockSetFn = vi.fn().mockReturnThis()
    const mockWhereFn = vi.fn().mockResolvedValue([{ affected: 1 }])
    mockDb.update.mockReturnValue({
      set: mockSetFn,
      where: mockWhereFn,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('POST handler', () => {
    it('should encounter a permission error when trying to update subscription seats', async () => {
      vi.doMock('@/lib/subscription/utils', () => ({
        checkEnterprisePlan: vi.fn().mockReturnValue(true),
      }))

      mockDb.select.mockImplementationOnce(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn().mockResolvedValue([mockSubscription]),
      }))

      mockDb.select.mockImplementationOnce(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn().mockResolvedValue([]),
      }))

      const req = createMockRequest('POST', {
        seats: 10,
      })

      const { POST } = await import('./route')

      const response = await POST(req, { params: Promise.resolve({ id: 'sub-123' }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty(
        'error',
        'Unauthorized - you do not have permission to modify this subscription'
      )
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('should reject team plan subscription updates', async () => {
      vi.doMock('@/lib/subscription/utils', () => ({
        checkEnterprisePlan: vi.fn().mockReturnValue(false),
      }))

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

    it('should encounter permission issues with personal subscription updates', async () => {
      vi.doMock('@/lib/subscription/utils', () => ({
        checkEnterprisePlan: vi.fn().mockReturnValue(true),
      }))

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

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error')
    })

    it('should reject updates from non-admin members', async () => {
      vi.doMock('@/lib/subscription/utils', () => ({
        checkEnterprisePlan: vi.fn().mockReturnValue(true),
      }))

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

      expect(response.status).toBe(403)
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

    it('should handle subscription not found with permission error', async () => {
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

      expect(response.status).toBe(403)
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
