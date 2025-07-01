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
    vi.resetModules()

    mockExecutionDependencies()

    // Mock the normalized tables helper
    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadWorkflowFromNormalizedTables: vi.fn().mockResolvedValue({
        blocks: sampleWorkflowState.blocks,
        edges: sampleWorkflowState.edges || [],
        loops: sampleWorkflowState.loops || {},
        parallels: {},
        isFromNormalizedTables: true,
      }),
    }))

    vi.doMock('croner', () => ({
      Cron: vi.fn().mockImplementation(() => ({
        nextRun: vi.fn().mockReturnValue(new Date(Date.now() + 60000)), // Next run in 1 minute
      })),
    }))

    vi.doMock('@/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table: string) => {
            if (table === 'schedule') {
              return {
                where: vi.fn().mockImplementation(() => ({
                  limit: vi.fn().mockImplementation(() => [
                    {
                      id: 'schedule-id',
                      workflowId: 'workflow-id',
                      userId: 'user-id',
                      nextRunAt: new Date(Date.now() - 60000), // Due 1 minute ago
                      lastRanAt: new Date(Date.now() - 3600000), // Last ran 1 hour ago
                      cronExpression: '*/15 * * * *',
                    },
                  ]),
                })),
              }
            }
            if (table === 'workflow') {
              return {
                where: vi.fn().mockImplementation(() => ({
                  limit: vi.fn().mockImplementation(() => [
                    {
                      id: 'workflow-id',
                      userId: 'user-id',
                      state: sampleWorkflowState,
                    },
                  ]),
                })),
              }
            }
            if (table === 'environment') {
              return {
                where: vi.fn().mockImplementation(() => ({
                  limit: vi.fn().mockImplementation(() => [
                    {
                      userId: 'user-id',
                      variables: {
                        OPENAI_API_KEY: 'encrypted:openai-api-key',
                        SERPER_API_KEY: 'encrypted:serper-api-key',
                      },
                    },
                  ]),
                })),
              }
            }
            return {
              where: vi.fn().mockImplementation(() => ({
                limit: vi.fn().mockImplementation(() => []),
              })),
            }
          }),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
      }

      return { db: mockDb }
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

    const { GET } = await import('./route')
    const response = await GET()
    expect(response).toBeDefined()

    const data = await response.json()
    expect(data).toHaveProperty('message')
    expect(data).toHaveProperty('executedCount')
  })

  it('should handle errors during scheduled execution gracefully', async () => {
    const persistExecutionErrorMock = vi.fn().mockResolvedValue(undefined)

    vi.doMock('@/lib/logs/execution-logger', () => ({
      persistExecutionError: persistExecutionErrorMock,
    }))

    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: vi.fn().mockRejectedValue(new Error('Execution failed')),
      })),
    }))

    const { GET } = await import('./route')
    const response = await GET()

    expect(response).toBeDefined()

    const data = await response.json()
    expect(data).toHaveProperty('message')
  })

  it('should handle case with no due schedules', async () => {
    vi.doMock('@/db', () => {
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

    const { GET } = await import('./route')
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

  it('should handle scheduler-level errors gracefully', async () => {
    vi.doMock('@/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          throw new Error('Database error')
        }),
        update: vi.fn(),
      }

      return { db: mockDb }
    })

    const { GET } = await import('./route')
    const response = await GET()
    expect(response.status).toBe(500)
    const data = await response.json()

    expect(data).toHaveProperty('error', 'Database error')
  })

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

    const { GET } = await import('./route')
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

    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('executedCount', 0)

    expect(executeMock).not.toHaveBeenCalled()
  })
})
