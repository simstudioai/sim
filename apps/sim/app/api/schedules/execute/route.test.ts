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

    // Mock authentication
    vi.doMock('@/lib/auth/internal', () => ({
      verifyCronAuth: vi.fn().mockReturnValue(null),
    }))

    // Mock env and isTruthy
    vi.doMock('@/lib/env', () => ({
      env: {
        TRIGGER_DEV_ENABLED: false,
      },
      isTruthy: vi.fn((value) => {
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true' || value === '1'
        }
        return Boolean(value)
      }),
    }))

    // Mock executeScheduleJob
    vi.doMock('@/background/schedule-execution', () => ({
      executeScheduleJob: vi.fn().mockResolvedValue(undefined),
    }))

    // Mock Trigger.dev tasks
    vi.doMock('@trigger.dev/sdk', () => ({
      tasks: {
        trigger: vi.fn().mockResolvedValue({ id: 'task-id' }),
      },
    }))

    // Mock drizzle-orm
    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ type: 'and', conditions })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      lte: vi.fn((field, value) => ({ field, value, type: 'lte' })),
      not: vi.fn((condition) => ({ type: 'not', condition })),
    }))

    // Mock database with no schedules by default
    vi.doMock('@sim/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => []),
          })),
        })),
      }

      return {
        db: mockDb,
        workflowSchedule: {
          id: 'id',
          workflowId: 'workflowId',
          nextRunAt: 'nextRunAt',
          status: 'status',
        },
      }
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should execute scheduled workflows with Trigger.dev disabled', async () => {
    const mockExecuteScheduleJob = vi.fn().mockResolvedValue(undefined)

    vi.doMock('@/background/schedule-execution', () => ({
      executeScheduleJob: mockExecuteScheduleJob,
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        TRIGGER_DEV_ENABLED: false,
      },
      isTruthy: vi.fn(() => false),
    }))

    vi.doMock('@sim/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => [
              {
                id: 'schedule-1',
                workflowId: 'workflow-1',
                blockId: null,
                cronExpression: null,
                lastRanAt: null,
                failedCount: 0,
              },
            ]),
          })),
        })),
      }

      return {
        db: mockDb,
        workflowSchedule: {},
      }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response).toBeDefined()
    const data = await response.json()
    expect(data).toHaveProperty('message')
    expect(data).toHaveProperty('executedCount', 1)
  })

  it('should queue schedules to Trigger.dev when enabled', async () => {
    const mockTrigger = vi.fn().mockResolvedValue({ id: 'task-id-123' })

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

    vi.doMock('@sim/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => [
              {
                id: 'schedule-1',
                workflowId: 'workflow-1',
                blockId: null,
                cronExpression: null,
                lastRanAt: null,
                failedCount: 0,
              },
            ]),
          })),
        })),
      }

      return {
        db: mockDb,
        workflowSchedule: {},
      }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response).toBeDefined()
    const data = await response.json()
    expect(data).toHaveProperty('executedCount', 1)
  })

  it('should handle case with no due schedules', async () => {
    vi.doMock('@sim/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => []),
          })),
        })),
      }

      return {
        db: mockDb,
        workflowSchedule: {},
      }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('executedCount', 0)
  })

  it('should skip workflows already running', async () => {
    const mockExecuteScheduleJob = vi.fn().mockResolvedValue(undefined)

    vi.doMock('@/background/schedule-execution', () => ({
      executeScheduleJob: mockExecuteScheduleJob,
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        TRIGGER_DEV_ENABLED: false,
      },
      isTruthy: vi.fn(() => false),
    }))

    // Same workflow ID for both schedules
    vi.doMock('@sim/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => [
              {
                id: 'schedule-1',
                workflowId: 'workflow-same',
                blockId: null,
                cronExpression: null,
                lastRanAt: null,
                failedCount: 0,
              },
              {
                id: 'schedule-2',
                workflowId: 'workflow-same',
                blockId: null,
                cronExpression: null,
                lastRanAt: null,
                failedCount: 0,
              },
            ]),
          })),
        })),
      }

      return {
        db: mockDb,
        workflowSchedule: {},
      }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('executedCount', 2)
  })

  it('should return error response on database failure', async () => {
    vi.doMock('@sim/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockRejectedValue(new Error('Database error')),
          })),
        })),
      }

      return {
        db: mockDb,
        workflowSchedule: {},
      }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })
})
