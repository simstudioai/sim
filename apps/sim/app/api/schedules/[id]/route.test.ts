/**
 * Tests for schedule reactivate PUT API route
 *
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetUserEntityPermissions, mockDbSelect, mockDbUpdate } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
    mockDbSelect: vi.fn(),
    mockDbUpdate: vi.fn(),
  })
)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflow: { id: 'id', userId: 'userId', workspaceId: 'workspaceId' },
  workflowSchedule: { id: 'id', workflowId: 'workflowId', status: 'status' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: () => 'test-request-id',
}))

vi.mock('@sim/logger', () => loggerMock)

import { PUT } from './route'

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://test/api/schedules/sched-1'), {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function createParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function mockDbChain(selectResults: unknown[][]) {
  let selectCallIndex = 0
  mockDbSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => selectResults[selectCallIndex++] || [],
      }),
    }),
  }))

  mockDbUpdate.mockImplementation(() => ({
    set: () => ({
      where: vi.fn().mockResolvedValue({}),
    }),
  }))
}

describe('Schedule PUT API (Reactivate)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('write')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('Request Validation', () => {
    it('returns 400 when action is not reactivate', async () => {
      mockDbChain([
        [{ id: 'sched-1', workflowId: 'wf-1', status: 'disabled' }],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const res = await PUT(createRequest({ action: 'disable' }), createParams('sched-1'))

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe('Invalid request body')
    })

    it('returns 400 when action is missing', async () => {
      mockDbChain([
        [{ id: 'sched-1', workflowId: 'wf-1', status: 'disabled' }],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const res = await PUT(createRequest({}), createParams('sched-1'))

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe('Invalid request body')
    })
  })

  describe('Schedule Not Found', () => {
    it('returns 404 when schedule does not exist', async () => {
      mockDbChain([[]])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-999'))

      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe('Schedule not found')
    })

    it('returns 404 when workflow does not exist for schedule', async () => {
      mockDbChain([[{ id: 'sched-1', workflowId: 'wf-1', status: 'disabled' }], []])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe('Workflow not found')
    })
  })

  describe('Authorization', () => {
    it('returns 403 when user is not workflow owner', async () => {
      mockDbChain([
        [{ id: 'sched-1', workflowId: 'wf-1', status: 'disabled' }],
        [{ userId: 'other-user', workspaceId: null }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('Not authorized to modify this schedule')
    })

    it('returns 403 for workspace member with only read permission', async () => {
      mockGetUserEntityPermissions.mockResolvedValue('read')
      mockDbChain([
        [{ id: 'sched-1', workflowId: 'wf-1', status: 'disabled' }],
        [{ userId: 'other-user', workspaceId: 'ws-1' }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(403)
    })

    it('allows workflow owner to reactivate', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '*/5 * * * *',
            timezone: 'UTC',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.message).toBe('Schedule activated successfully')
    })

    it('allows workspace member with write permission to reactivate', async () => {
      mockGetUserEntityPermissions.mockResolvedValue('write')
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '*/5 * * * *',
            timezone: 'UTC',
          },
        ],
        [{ userId: 'other-user', workspaceId: 'ws-1' }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
    })

    it('allows workspace admin to reactivate', async () => {
      mockGetUserEntityPermissions.mockResolvedValue('admin')
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '*/5 * * * *',
            timezone: 'UTC',
          },
        ],
        [{ userId: 'other-user', workspaceId: 'ws-1' }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
    })
  })

  describe('Schedule State Handling', () => {
    it('returns success message when schedule is already active', async () => {
      mockDbChain([
        [{ id: 'sched-1', workflowId: 'wf-1', status: 'active' }],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.message).toBe('Schedule is already active')
      expect(mockDbUpdate).not.toHaveBeenCalled()
    })

    it('successfully reactivates disabled schedule', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '*/5 * * * *',
            timezone: 'UTC',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.message).toBe('Schedule activated successfully')
      expect(data.nextRunAt).toBeDefined()
      expect(mockDbUpdate).toHaveBeenCalled()
    })

    it('returns 400 when schedule has no cron expression', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: null,
            timezone: 'UTC',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe('Schedule has no cron expression')
    })

    it('returns 400 when schedule has invalid cron expression', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: 'invalid-cron',
            timezone: 'UTC',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe('Schedule has invalid cron expression')
    })

    it('calculates nextRunAt from stored cron expression (every 5 minutes)', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '*/5 * * * *',
            timezone: 'UTC',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const beforeCall = Date.now()
      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))
      const afterCall = Date.now()

      expect(res.status).toBe(200)
      const data = await res.json()
      const nextRunAt = new Date(data.nextRunAt).getTime()

      // nextRunAt should be within 0-5 minutes in the future
      expect(nextRunAt).toBeGreaterThan(beforeCall)
      expect(nextRunAt).toBeLessThanOrEqual(afterCall + 5 * 60 * 1000 + 1000)
      // Should align with 5-minute intervals (minute divisible by 5)
      expect(new Date(nextRunAt).getUTCMinutes() % 5).toBe(0)
    })

    it('calculates nextRunAt from daily cron expression', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '30 14 * * *', // 2:30 PM daily
            timezone: 'UTC',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const beforeCall = Date.now()
      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      const nextRunAt = new Date(data.nextRunAt)

      // Should be a future date at 14:30 UTC
      expect(nextRunAt.getTime()).toBeGreaterThan(beforeCall)
      expect(nextRunAt.getUTCHours()).toBe(14)
      expect(nextRunAt.getUTCMinutes()).toBe(30)
      expect(nextRunAt.getUTCSeconds()).toBe(0)
    })

    it('calculates nextRunAt from weekly cron expression', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '0 9 * * 1', // Monday at 9:00 AM
            timezone: 'UTC',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const beforeCall = Date.now()
      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      const nextRunAt = new Date(data.nextRunAt)

      // Should be a future date on Monday at 09:00 UTC
      expect(nextRunAt.getTime()).toBeGreaterThan(beforeCall)
      expect(nextRunAt.getUTCDay()).toBe(1) // Monday
      expect(nextRunAt.getUTCHours()).toBe(9)
      expect(nextRunAt.getUTCMinutes()).toBe(0)
    })

    it('calculates nextRunAt from monthly cron expression', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '0 10 15 * *', // 15th of month at 10:00 AM
            timezone: 'UTC',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const beforeCall = Date.now()
      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      const nextRunAt = new Date(data.nextRunAt)

      // Should be a future date on the 15th at 10:00 UTC
      expect(nextRunAt.getTime()).toBeGreaterThan(beforeCall)
      expect(nextRunAt.getUTCDate()).toBe(15)
      expect(nextRunAt.getUTCHours()).toBe(10)
      expect(nextRunAt.getUTCMinutes()).toBe(0)
    })
  })

  describe('Timezone Handling in Reactivation', () => {
    it('calculates nextRunAt with America/New_York timezone', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '0 9 * * *', // 9:00 AM Eastern
            timezone: 'America/New_York',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const beforeCall = Date.now()
      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      const nextRunAt = new Date(data.nextRunAt)

      // Should be a future date
      expect(nextRunAt.getTime()).toBeGreaterThan(beforeCall)
      // The exact UTC hour will depend on DST, but it should be 13:00 or 14:00 UTC
      const utcHour = nextRunAt.getUTCHours()
      expect([13, 14]).toContain(utcHour) // 9 AM ET = 1-2 PM UTC depending on DST
      expect(nextRunAt.getUTCMinutes()).toBe(0)
    })

    it('calculates nextRunAt with Asia/Tokyo timezone', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '30 15 * * *', // 3:30 PM Japan Time
            timezone: 'Asia/Tokyo',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const beforeCall = Date.now()
      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      const nextRunAt = new Date(data.nextRunAt)

      // Should be a future date
      expect(nextRunAt.getTime()).toBeGreaterThan(beforeCall)
      // 3:30 PM JST (UTC+9) = 6:30 AM UTC
      expect(nextRunAt.getUTCHours()).toBe(6)
      expect(nextRunAt.getUTCMinutes()).toBe(30)
    })

    it('calculates nextRunAt with Europe/London timezone', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '0 12 * * 5', // Friday at noon London time
            timezone: 'Europe/London',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const beforeCall = Date.now()
      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      const nextRunAt = new Date(data.nextRunAt)

      // Should be a future date on Friday
      expect(nextRunAt.getTime()).toBeGreaterThan(beforeCall)
      expect(nextRunAt.getUTCDay()).toBe(5) // Friday
      // UTC hour depends on BST/GMT (11:00 or 12:00 UTC)
      const utcHour = nextRunAt.getUTCHours()
      expect([11, 12]).toContain(utcHour)
      expect(nextRunAt.getUTCMinutes()).toBe(0)
    })

    it('uses UTC as default timezone when timezone is not set', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '0 10 * * *', // 10:00 AM
            timezone: null,
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const beforeCall = Date.now()
      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      const nextRunAt = new Date(data.nextRunAt)

      // Should be a future date at 10:00 UTC
      expect(nextRunAt.getTime()).toBeGreaterThan(beforeCall)
      expect(nextRunAt.getUTCHours()).toBe(10)
      expect(nextRunAt.getUTCMinutes()).toBe(0)
    })

    it('handles minutely schedules with timezone correctly', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '*/10 * * * *', // Every 10 minutes
            timezone: 'America/Los_Angeles',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const beforeCall = Date.now()
      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      const nextRunAt = new Date(data.nextRunAt)

      // Should be a future date within the next 10 minutes
      expect(nextRunAt.getTime()).toBeGreaterThan(beforeCall)
      expect(nextRunAt.getTime()).toBeLessThanOrEqual(beforeCall + 10 * 60 * 1000 + 1000)
      // Should align with 10-minute intervals
      expect(nextRunAt.getUTCMinutes() % 10).toBe(0)
    })

    it('handles hourly schedules with timezone correctly', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '15 * * * *', // At minute 15 of every hour
            timezone: 'America/Chicago',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const beforeCall = Date.now()
      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      const nextRunAt = new Date(data.nextRunAt)

      // Should be a future date at minute 15
      expect(nextRunAt.getTime()).toBeGreaterThan(beforeCall)
      expect(nextRunAt.getUTCMinutes()).toBe(15)
      expect(nextRunAt.getUTCSeconds()).toBe(0)
    })

    it('handles custom cron expressions with complex patterns and timezone', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: '0 9 * * 1-5', // Weekdays at 9 AM
            timezone: 'America/New_York',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const beforeCall = Date.now()
      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      const nextRunAt = new Date(data.nextRunAt)

      // Should be a future date on a weekday (1-5)
      expect(nextRunAt.getTime()).toBeGreaterThan(beforeCall)
      const dayOfWeek = nextRunAt.getUTCDay()
      expect([1, 2, 3, 4, 5]).toContain(dayOfWeek)
    })
  })

  describe('Error Handling', () => {
    it('returns 500 when database operation fails', async () => {
      mockDbSelect.mockImplementation(() => {
        throw new Error('Database connection failed')
      })

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toBe('Failed to update schedule')
    })
  })
})
