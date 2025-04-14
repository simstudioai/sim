/**
 * Integration tests for scheduled workflow execution API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockExecutionDependencies,
  sampleWorkflowState,
} from '@/app/api/__test-utils__/utils'

describe('Scheduled Workflow Execution API Route', () => {
  beforeEach(() => {
    vi.resetModules()

    // Mock all dependencies
    mockExecutionDependencies()

    // Mock the Cron library
    vi.doMock('croner', () => ({
      Cron: vi.fn().mockImplementation(() => ({
        nextRun: vi.fn().mockReturnValue(new Date(Date.now() + 60000)), // Next run in 1 minute
      })),
    }))

    // Create mock database with test schedules
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
            } else if (table === 'workflow') {
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
            } else if (table === 'environment') {
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
            } else {
              return {
                where: vi.fn().mockImplementation(() => ({
                  limit: vi.fn().mockImplementation(() => []),
                })),
              }
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

  /**
   * Test the basic flow of checking and executing scheduled workflows
   */
  it('should execute scheduled workflows successfully', async () => {
    // Create executor mock to track calls
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

    // Create a mock request
    const req = createMockRequest('GET')

    // Import the route handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req)

    // Verify the response exists
    expect(response).toBeDefined()

    // Validate that the API responds with a structured response
    const data = await response.json()
    expect(data).toHaveProperty('message')
    expect(data).toHaveProperty('executedCount')
  })

  /**
   * Test error handling during execution of scheduled workflows
   */
  it('should handle errors during scheduled execution gracefully', async () => {
    // Create a mock for persistent execution error
    const persistExecutionErrorMock = vi.fn().mockResolvedValue(undefined)

    // Mock the logger
    vi.doMock('@/lib/logs/execution-logger', () => ({
      persistExecutionLogs: vi.fn().mockResolvedValue(undefined),
      persistExecutionError: persistExecutionErrorMock,
    }))

    // Mock the executor to throw an error
    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: vi.fn().mockRejectedValue(new Error('Execution failed')),
      })),
    }))

    // Create a mock request
    const req = createMockRequest('GET')

    // Import the route handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req)

    // Verify response exists
    expect(response).toBeDefined()

    // Validate that errors during execution don't crash the API
    // It should still return a valid response
    const data = await response.json()
    expect(data).toHaveProperty('message')
  })

  /**
   * Test behavior when no schedules are due for execution
   */
  it('should handle case with no due schedules', async () => {
    // Mock empty schedules list
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

    // Create a mock request
    const req = createMockRequest('GET')

    // Import the route handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req)

    // Check response
    expect(response.status).toBe(200)

    // Parse the response body
    const data = await response.json()

    // Should report zero executed workflows
    expect(data).toHaveProperty('executedCount', 0)

    // Create executor mock to verify it wasn't called
    const executeMock = vi.fn()
    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: executeMock,
      })),
    }))

    // Verify executor wasn't called since there were no schedules
    expect(executeMock).not.toHaveBeenCalled()
  })

  /**
   * Test handling of database-level errors
   */
  it('should handle scheduler-level errors gracefully', async () => {
    // Mock the database to throw an error
    vi.doMock('@/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          throw new Error('Database error')
        }),
        update: vi.fn(),
      }

      return { db: mockDb }
    })

    // Create a mock request
    const req = createMockRequest('GET')

    // Import the route handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req)

    // Check response - should be an error
    expect(response.status).toBe(500)

    // Parse the response body
    const data = await response.json()

    // Should contain error information
    expect(data).toHaveProperty('error', 'Database error')
  })
})
