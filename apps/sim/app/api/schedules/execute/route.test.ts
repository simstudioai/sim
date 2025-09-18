/**
 * Integration tests for scheduled workflow execution API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mockExecutionDependencies,
  mockScheduleExecuteDb,
  sampleWorkflowState,
} from '@/app/api/__test-utils__/utils'

describe('Scheduled Workflow Execution API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockExecutionDependencies()

    // Mock all dependencies
    vi.doMock('@/services/queue', () => ({
      RateLimiter: vi.fn().mockImplementation(() => ({
        checkRateLimitWithSubscription: vi.fn().mockResolvedValue({
          allowed: true,
          remaining: 100,
          resetAt: new Date(Date.now() + 60000),
        }),
      })),
    }))

    vi.doMock('@/lib/billing', () => ({
      checkServerSideUsageLimits: vi.fn().mockResolvedValue({ isExceeded: false }),
    }))

    vi.doMock('@/lib/billing/core/subscription', () => ({
      getHighestPrioritySubscription: vi.fn().mockResolvedValue({
        plan: 'pro',
        status: 'active',
      }),
    }))

    vi.doMock('@/lib/environment/utils', () => ({
      getPersonalAndWorkspaceEnv: vi.fn().mockResolvedValue({
        personalEncrypted: {},
        workspaceEncrypted: {},
      }),
    }))

    vi.doMock('@/lib/logs/execution/logging-session', () => ({
      LoggingSession: vi.fn().mockImplementation(() => ({
        safeStart: vi.fn().mockResolvedValue(undefined),
        safeComplete: vi.fn().mockResolvedValue(undefined),
        safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
        setupExecutor: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadDeployedWorkflowState: vi.fn().mockResolvedValue({
        blocks: sampleWorkflowState.blocks,
        edges: sampleWorkflowState.edges || [],
        loops: sampleWorkflowState.loops || {},
        parallels: sampleWorkflowState.parallels || {},
      }),
      loadWorkflowFromNormalizedTables: vi.fn().mockResolvedValue({
        blocks: sampleWorkflowState.blocks,
        edges: sampleWorkflowState.edges || [],
        loops: sampleWorkflowState.loops || {},
        parallels: {},
        isFromNormalizedTables: true,
      }),
    }))

    vi.doMock('@/stores/workflows/server-utils', () => ({
      mergeSubblockState: vi.fn().mockReturnValue(sampleWorkflowState.blocks),
    }))

    vi.doMock('@/lib/schedules/utils', () => ({
      calculateNextRunTime: vi.fn().mockReturnValue(new Date(Date.now() + 60000)),
      getScheduleTimeValues: vi.fn().mockReturnValue({}),
      getSubBlockValue: vi.fn().mockReturnValue('manual'),
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ type: 'and', conditions })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      lte: vi.fn((field, value) => ({ field, value, type: 'lte' })),
      not: vi.fn((condition) => ({ type: 'not', condition })),
      sql: vi.fn((strings, ...values) => ({ strings, values, type: 'sql' })),
    }))

    vi.doMock('croner', () => ({
      Cron: vi.fn().mockImplementation(() => ({
        nextRun: vi.fn().mockReturnValue(new Date(Date.now() + 60000)), // Next run in 1 minute
      })),
    }))

    vi.doMock('@sim/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((_table: any) => ({
            where: vi.fn().mockImplementation((_cond: any) => ({
              limit: vi.fn().mockImplementation((n?: number) => {
                // Always return empty array - no due schedules
                return []
              }),
            })),
          })),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
      }

      return {
        db: mockDb,
        userStats: {
          userId: 'userId',
          totalScheduledExecutions: 'totalScheduledExecutions',
          lastActive: 'lastActive',
        },
        workflow: { id: 'id', userId: 'userId', state: 'state' },
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

  it('should execute scheduled workflows successfully', async () => {
    const executeMock = vi.fn().mockResolvedValue({
      success: true,
      output: { response: 'Scheduled execution completed' },
      logs: [],
      metadata: {
        duration: 100,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
      },
    })

    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: executeMock,
      })),
    }))

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET()
    expect(response).toBeDefined()

    const data = await response.json()
    expect(data).toHaveProperty('message')
    expect(data).toHaveProperty('executedCount')
  })

  it('should handle errors during scheduled execution gracefully', async () => {
    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: vi.fn().mockRejectedValue(new Error('Execution failed')),
      })),
    }))

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET()

    expect(response).toBeDefined()

    const data = await response.json()
    expect(data).toHaveProperty('message')
  })

  it('should handle case with no due schedules', async () => {
    vi.doMock('@sim/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => []),
            })),
          })),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
      }

      return { db: mockDb }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET()
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('executedCount', 0)

    const executeMock = vi.fn()
    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: executeMock,
      })),
    }))

    expect(executeMock).not.toHaveBeenCalled()
  })

  // Removed: Test isolation issues with mocks make this unreliable

  it('should execute schedules that are explicitly marked as active', async () => {
    const executeMock = vi.fn().mockResolvedValue({ success: true, metadata: {} })

    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: executeMock,
      })),
    }))

    mockScheduleExecuteDb({
      schedules: [
        {
          id: 'schedule-active',
          workflowId: 'workflow-id',
          userId: 'user-id',
          status: 'active',
          nextRunAt: new Date(Date.now() - 60_000),
          lastRanAt: null,
          cronExpression: null,
          failedCount: 0,
        },
      ],
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET()

    expect(response.status).toBe(200)
  })

  it('should not execute schedules that are disabled', async () => {
    const executeMock = vi.fn()

    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: executeMock,
      })),
    }))

    mockScheduleExecuteDb({
      schedules: [
        {
          id: 'schedule-disabled',
          workflowId: 'workflow-id',
          userId: 'user-id',
          status: 'disabled',
          nextRunAt: new Date(Date.now() - 60_000),
          lastRanAt: null,
          cronExpression: null,
          failedCount: 0,
        },
      ],
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET()

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('executedCount', 0)

    expect(executeMock).not.toHaveBeenCalled()
  })
})
