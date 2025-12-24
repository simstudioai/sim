/**
 * Tests for schedule reactivate PUT API route
 *
 * @vitest-environment node
 */
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

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { PUT } from '@/app/api/schedules/[id]/route'

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
        [{ id: 'sched-1', workflowId: 'wf-1', status: 'disabled' }],
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
        [{ id: 'sched-1', workflowId: 'wf-1', status: 'disabled' }],
        [{ userId: 'other-user', workspaceId: 'ws-1' }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
    })

    it('allows workspace admin to reactivate', async () => {
      mockGetUserEntityPermissions.mockResolvedValue('admin')
      mockDbChain([
        [{ id: 'sched-1', workflowId: 'wf-1', status: 'disabled' }],
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
        [{ id: 'sched-1', workflowId: 'wf-1', status: 'disabled' }],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.message).toBe('Schedule activated successfully')
      expect(data.nextRunAt).toBeDefined()
      expect(mockDbUpdate).toHaveBeenCalled()
    })

    it('sets nextRunAt to approximately 1 minute in future', async () => {
      mockDbChain([
        [{ id: 'sched-1', workflowId: 'wf-1', status: 'disabled' }],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const beforeCall = Date.now()
      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))
      const afterCall = Date.now()

      expect(res.status).toBe(200)
      const data = await res.json()
      const nextRunAt = new Date(data.nextRunAt).getTime()

      // nextRunAt should be ~60 seconds from now
      expect(nextRunAt).toBeGreaterThanOrEqual(beforeCall + 60000 - 1000)
      expect(nextRunAt).toBeLessThanOrEqual(afterCall + 60000 + 1000)
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
