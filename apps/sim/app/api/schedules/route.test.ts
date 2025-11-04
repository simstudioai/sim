/**
 * Integration tests for schedule configuration API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockExecutionDependencies,
  sampleWorkflowState,
} from '@/app/api/__test-utils__/utils'

describe('Schedule Configuration API Route', () => {
  beforeEach(() => {
    vi.resetModules()

    mockExecutionDependencies()

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: {
          id: 'user-id',
          email: 'test@example.com',
        },
      }),
    }))

    vi.doMock('@/lib/permissions/utils', () => ({
      getUserEntityPermissions: vi.fn().mockResolvedValue('admin'), // User has admin permissions
    }))

    const _workflowStateWithSchedule = {
      ...sampleWorkflowState,
      blocks: {
        ...sampleWorkflowState.blocks,
        'starter-id': {
          ...sampleWorkflowState.blocks['starter-id'],
          subBlocks: {
            ...sampleWorkflowState.blocks['starter-id'].subBlocks,
            startWorkflow: { id: 'startWorkflow', type: 'dropdown', value: 'schedule' },
            scheduleType: { id: 'scheduleType', type: 'dropdown', value: 'daily' },
            scheduleTime: { id: 'scheduleTime', type: 'time-input', value: '09:30' },
            dailyTime: { id: 'dailyTime', type: 'time-input', value: '09:30' },
          },
        },
      },
    }

    vi.doMock('@sim/db', () => {
      let callCount = 0
      const mockInsert = {
        values: vi.fn().mockImplementation(() => ({
          onConflictDoUpdate: vi.fn().mockResolvedValue({}),
        })),
      }

      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                callCount++
                // First call: workflow lookup for authorization
                if (callCount === 1) {
                  return [
                    {
                      id: 'workflow-id',
                      userId: 'user-id',
                      workspaceId: null, // User owns the workflow directly
                    },
                  ]
                }
                // Second call: existing schedule lookup - return existing schedule for update test
                return [
                  {
                    id: 'existing-schedule-id',
                    workflowId: 'workflow-id',
                    blockId: 'starter-id',
                    cronExpression: '0 9 * * *',
                    nextRunAt: new Date(),
                    status: 'active',
                  },
                ]
              }),
            })),
          })),
        })),
        insert: vi.fn().mockReturnValue(mockInsert),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
        delete: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
        transaction: vi.fn().mockImplementation(async (callback) => {
          const tx = {
            insert: vi.fn().mockReturnValue(mockInsert),
          }
          return callback(tx)
        }),
      }

      return { db: mockDb }
    })

    vi.doMock('crypto', () => ({
      randomUUID: vi.fn(() => 'test-uuid'),
      default: {
        randomUUID: vi.fn(() => 'test-uuid'),
      },
    }))

    vi.doMock('@/lib/schedules/utils', () => ({
      getScheduleTimeValues: vi.fn().mockReturnValue({
        scheduleTime: '09:30',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 30],
        weeklyDay: 1,
        weeklyTime: [9, 30],
        monthlyDay: 1,
        monthlyTime: [9, 30],
      }),
      getSubBlockValue: vi.fn().mockImplementation((block: any, id: string) => {
        const subBlocks = {
          startWorkflow: 'schedule',
          scheduleType: 'daily',
          scheduleTime: '09:30',
          dailyTime: '09:30',
        }
        return subBlocks[id as keyof typeof subBlocks] || ''
      }),
      generateCronExpression: vi.fn().mockReturnValue('0 9 * * *'),
      calculateNextRunTime: vi.fn().mockReturnValue(new Date()),
      validateCronExpression: vi.fn().mockReturnValue({ isValid: true }),
      BlockState: {},
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test creating a new schedule
   */
  it('should create a new schedule successfully', async () => {
    const req = createMockRequest('POST', {
      workflowId: 'workflow-id',
      state: {
        blocks: {
          'starter-id': {
            type: 'starter',
            subBlocks: {
              startWorkflow: { value: 'schedule' },
              scheduleType: { value: 'daily' },
              scheduleTime: { value: '09:30' },
              dailyTime: { value: '09:30' },
            },
          },
        },
        edges: [],
        loops: {},
      },
    })

    const { POST } = await import('@/app/api/schedules/route')

    const response = await POST(req)

    expect(response).toBeDefined()
    expect(response.status).toBe(200)

    const responseData = await response.json()
    expect(responseData).toHaveProperty('message', 'Schedule updated')
    expect(responseData).toHaveProperty('cronExpression', '0 9 * * *')
    expect(responseData).toHaveProperty('nextRunAt')

    // We can't verify the utility functions were called directly
    // since we're mocking them at the module level
    // Instead, we just verify that the response has the expected properties
  })

  /**
   * Test error handling
   */
  it('should handle errors gracefully', async () => {
    vi.doMock('@sim/db', () => ({
      db: {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => []),
            })),
          })),
        })),
        insert: vi.fn().mockImplementation(() => {
          throw new Error('Database error')
        }),
      },
    }))

    const req = createMockRequest('POST', {
      workflowId: 'workflow-id',
      state: { blocks: {}, edges: [], loops: {} },
    })

    const { POST } = await import('@/app/api/schedules/route')

    const response = await POST(req)

    expect(response.status).toBeGreaterThanOrEqual(400)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  /**
   * Test authentication requirement
   */
  it('should require authentication', async () => {
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue(null),
    }))

    const req = createMockRequest('POST', {
      workflowId: 'workflow-id',
      state: { blocks: {}, edges: [], loops: {} },
    })

    const { POST } = await import('@/app/api/schedules/route')

    const response = await POST(req)

    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data).toHaveProperty('error', 'Unauthorized')
  })

  /**
   * Test invalid data handling
   */
  it('should validate input data', async () => {
    const req = createMockRequest('POST', {
      workflowId: 'workflow-id',
    })

    const { POST } = await import('@/app/api/schedules/route')

    const response = await POST(req)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data).toHaveProperty('error', 'Invalid request data')
  })
})
