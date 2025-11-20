/**
 * Integration tests for scheduled workflow execution API route
 *
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function createMockRequest(): NextRequest {
  const mockHeaders = new Map([
    ['authorization', 'Bearer test-cron-secret'],
    ['content-type', 'application/json'],
  ])

  return {
    headers: {
      get: (key: string) => mockHeaders.get(key.toLowerCase()) || null,
    },
    url: 'http://localhost:3000/api/schedules/execute',
  } as NextRequest
}

describe('Scheduled Workflow Execution API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('should execute scheduled workflows with Trigger.dev disabled', async () => {
    const mockExecuteScheduleJob = vi.fn().mockResolvedValue(undefined)

    vi.doMock('@/lib/auth/internal', () => ({
      verifyCronAuth: vi.fn().mockReturnValue(null),
    }))

    vi.doMock('@/background/schedule-execution', () => ({
      executeScheduleJob: mockExecuteScheduleJob,
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        TRIGGER_DEV_ENABLED: false,
      },
      isTruthy: vi.fn(() => false),
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ type: 'and', conditions })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      lte: vi.fn((field, value) => ({ field, value, type: 'lte' })),
      lt: vi.fn((field, value) => ({ field, value, type: 'lt' })),
      not: vi.fn((condition) => ({ type: 'not', condition })),
      isNull: vi.fn((field) => ({ type: 'isNull', field })),
      or: vi.fn((...conditions) => ({ type: 'or', conditions })),
    }))

    vi.doMock('@sim/db', () => {
      const returningSchedules = [
        {
          id: 'schedule-1',
          workflowId: 'workflow-1',
          blockId: null,
          cronExpression: null,
          lastRanAt: null,
          failedCount: 0,
          nextRunAt: new Date('2025-01-01T00:00:00.000Z'),
          lastQueuedAt: undefined,
        },
      ]

      const mockReturning = vi.fn().mockReturnValue(returningSchedules)
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning })
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
      const mockUpdate = vi.fn().mockReturnValue({ set: mockSet })

      return {
        db: {
          update: mockUpdate,
        },
        workflowSchedule: {
          id: 'id',
          workflowId: 'workflowId',
          blockId: 'blockId',
          cronExpression: 'cronExpression',
          lastRanAt: 'lastRanAt',
          failedCount: 'failedCount',
          status: 'status',
          nextRunAt: 'nextRunAt',
          lastQueuedAt: 'lastQueuedAt',
        },
      }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response).toBeDefined()
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('message')
    expect(data).toHaveProperty('executedCount', 1)
  })

  it('should queue schedules to Trigger.dev when enabled', async () => {
    const mockTrigger = vi.fn().mockResolvedValue({ id: 'task-id-123' })

    vi.doMock('@/lib/auth/internal', () => ({
      verifyCronAuth: vi.fn().mockReturnValue(null),
    }))

    vi.doMock('@trigger.dev/sdk', () => ({
      tasks: {
        trigger: mockTrigger,
      },
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        TRIGGER_DEV_ENABLED: true,
      },
      isTruthy: vi.fn(() => true),
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ type: 'and', conditions })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      lte: vi.fn((field, value) => ({ field, value, type: 'lte' })),
      lt: vi.fn((field, value) => ({ field, value, type: 'lt' })),
      not: vi.fn((condition) => ({ type: 'not', condition })),
      isNull: vi.fn((field) => ({ type: 'isNull', field })),
      or: vi.fn((...conditions) => ({ type: 'or', conditions })),
    }))

    vi.doMock('@sim/db', () => {
      const returningSchedules = [
        {
          id: 'schedule-1',
          workflowId: 'workflow-1',
          blockId: null,
          cronExpression: null,
          lastRanAt: null,
          failedCount: 0,
          nextRunAt: new Date('2025-01-01T00:00:00.000Z'),
          lastQueuedAt: undefined,
        },
      ]

      const mockReturning = vi.fn().mockReturnValue(returningSchedules)
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning })
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
      const mockUpdate = vi.fn().mockReturnValue({ set: mockSet })

      return {
        db: {
          update: mockUpdate,
        },
        workflowSchedule: {
          id: 'id',
          workflowId: 'workflowId',
          blockId: 'blockId',
          cronExpression: 'cronExpression',
          lastRanAt: 'lastRanAt',
          failedCount: 'failedCount',
          status: 'status',
          nextRunAt: 'nextRunAt',
          lastQueuedAt: 'lastQueuedAt',
        },
      }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response).toBeDefined()
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('executedCount', 1)
  })

  it('should handle case with no due schedules', async () => {
    vi.doMock('@/lib/auth/internal', () => ({
      verifyCronAuth: vi.fn().mockReturnValue(null),
    }))

    vi.doMock('@/background/schedule-execution', () => ({
      executeScheduleJob: vi.fn().mockResolvedValue(undefined),
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        TRIGGER_DEV_ENABLED: false,
      },
      isTruthy: vi.fn(() => false),
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ type: 'and', conditions })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      lte: vi.fn((field, value) => ({ field, value, type: 'lte' })),
      lt: vi.fn((field, value) => ({ field, value, type: 'lt' })),
      not: vi.fn((condition) => ({ type: 'not', condition })),
      isNull: vi.fn((field) => ({ type: 'isNull', field })),
      or: vi.fn((...conditions) => ({ type: 'or', conditions })),
    }))

    vi.doMock('@sim/db', () => {
      const mockReturning = vi.fn().mockReturnValue([])
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning })
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
      const mockUpdate = vi.fn().mockReturnValue({ set: mockSet })

      return {
        db: {
          update: mockUpdate,
        },
        workflowSchedule: {
          id: 'id',
          workflowId: 'workflowId',
          blockId: 'blockId',
          cronExpression: 'cronExpression',
          lastRanAt: 'lastRanAt',
          failedCount: 'failedCount',
          status: 'status',
          nextRunAt: 'nextRunAt',
          lastQueuedAt: 'lastQueuedAt',
        },
      }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('message')
    expect(data).toHaveProperty('executedCount', 0)
  })

  it('should execute multiple schedules in parallel', async () => {
    vi.doMock('@/lib/auth/internal', () => ({
      verifyCronAuth: vi.fn().mockReturnValue(null),
    }))

    vi.doMock('@/background/schedule-execution', () => ({
      executeScheduleJob: vi.fn().mockResolvedValue(undefined),
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        TRIGGER_DEV_ENABLED: false,
      },
      isTruthy: vi.fn(() => false),
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ type: 'and', conditions })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      lte: vi.fn((field, value) => ({ field, value, type: 'lte' })),
      lt: vi.fn((field, value) => ({ field, value, type: 'lt' })),
      not: vi.fn((condition) => ({ type: 'not', condition })),
      isNull: vi.fn((field) => ({ type: 'isNull', field })),
      or: vi.fn((...conditions) => ({ type: 'or', conditions })),
    }))

    vi.doMock('@sim/db', () => {
      const returningSchedules = [
        {
          id: 'schedule-1',
          workflowId: 'workflow-1',
          blockId: null,
          cronExpression: null,
          lastRanAt: null,
          failedCount: 0,
          nextRunAt: new Date('2025-01-01T00:00:00.000Z'),
          lastQueuedAt: undefined,
        },
        {
          id: 'schedule-2',
          workflowId: 'workflow-2',
          blockId: null,
          cronExpression: null,
          lastRanAt: null,
          failedCount: 0,
          nextRunAt: new Date('2025-01-01T01:00:00.000Z'),
          lastQueuedAt: undefined,
        },
      ]

      const mockReturning = vi.fn().mockReturnValue(returningSchedules)
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning })
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
      const mockUpdate = vi.fn().mockReturnValue({ set: mockSet })

      return {
        db: {
          update: mockUpdate,
        },
        workflowSchedule: {
          id: 'id',
          workflowId: 'workflowId',
          blockId: 'blockId',
          cronExpression: 'cronExpression',
          lastRanAt: 'lastRanAt',
          failedCount: 'failedCount',
          status: 'status',
          nextRunAt: 'nextRunAt',
          lastQueuedAt: 'lastQueuedAt',
        },
      }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('executedCount', 2)
  })
})
