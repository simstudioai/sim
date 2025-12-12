/**
 * Integration tests for schedule configuration API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockExecutionDependencies } from '@/app/api/__test-utils__/utils'

const {
  mockGetSession,
  mockGetUserEntityPermissions,
  mockSelectLimit,
  mockInsertValues,
  mockOnConflictDoUpdate,
  mockInsert,
  mockUpdate,
  mockDelete,
  mockTransaction,
  mockRandomUUID,
  mockGetScheduleTimeValues,
  mockGetSubBlockValue,
  mockGenerateCronExpression,
  mockCalculateNextRunTime,
  mockValidateCronExpression,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockInsertValues: vi.fn(),
  mockOnConflictDoUpdate: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockTransaction: vi.fn(),
  mockRandomUUID: vi.fn(),
  mockGetScheduleTimeValues: vi.fn(),
  mockGetSubBlockValue: vi.fn(),
  mockGenerateCronExpression: vi.fn(),
  mockCalculateNextRunTime: vi.fn(),
  mockValidateCronExpression: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: mockSelectLimit,
        }),
      }),
    }),
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflow: {
    id: 'workflow_id',
    userId: 'user_id',
    workspaceId: 'workspace_id',
  },
  workflowSchedule: {
    id: 'schedule_id',
    workflowId: 'workflow_id',
    blockId: 'block_id',
    cronExpression: 'cron_expression',
    nextRunAt: 'next_run_at',
    status: 'status',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args) => ({ type: 'eq', args })),
  and: vi.fn((...args) => ({ type: 'and', args })),
}))

vi.mock('crypto', () => ({
  randomUUID: mockRandomUUID,
  default: {
    randomUUID: mockRandomUUID,
  },
}))

vi.mock('@/lib/workflows/schedules/utils', () => ({
  getScheduleTimeValues: mockGetScheduleTimeValues,
  getSubBlockValue: mockGetSubBlockValue,
  generateCronExpression: mockGenerateCronExpression,
  calculateNextRunTime: mockCalculateNextRunTime,
  validateCronExpression: mockValidateCronExpression,
  BlockState: {},
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'test-request-id'),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('@/lib/core/telemetry', () => ({
  trackPlatformEvent: vi.fn(),
}))

import { db } from '@sim/db'
import { POST } from '@/app/api/schedules/route'

describe('Schedule Configuration API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    ;(db as any).transaction = mockTransaction

    mockExecutionDependencies()

    mockGetSession.mockResolvedValue({
      user: {
        id: 'user-id',
        email: 'test@example.com',
      },
    })

    mockGetUserEntityPermissions.mockResolvedValue('admin')

    mockSelectLimit.mockReturnValue([
      {
        id: 'workflow-id',
        userId: 'user-id',
        workspaceId: null,
      },
    ])

    mockInsertValues.mockImplementation(() => ({
      onConflictDoUpdate: mockOnConflictDoUpdate,
    }))
    mockOnConflictDoUpdate.mockResolvedValue({})

    mockInsert.mockReturnValue({
      values: mockInsertValues,
    })

    mockUpdate.mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    }))

    mockDelete.mockImplementation(() => ({
      where: vi.fn().mockResolvedValue([]),
    }))

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: mockInsertValues,
        }),
      }
      return callback(tx)
    })

    mockRandomUUID.mockReturnValue('test-uuid')

    mockGetScheduleTimeValues.mockReturnValue({
      scheduleTime: '09:30',
      minutesInterval: 15,
      hourlyMinute: 0,
      dailyTime: [9, 30],
      weeklyDay: 1,
      weeklyTime: [9, 30],
      monthlyDay: 1,
      monthlyTime: [9, 30],
    })

    mockGetSubBlockValue.mockImplementation((block: any, id: string) => {
      const subBlocks = {
        startWorkflow: 'schedule',
        scheduleType: 'daily',
        scheduleTime: '09:30',
        dailyTime: '09:30',
      }
      return subBlocks[id as keyof typeof subBlocks] || ''
    })

    mockGenerateCronExpression.mockReturnValue('0 9 * * *')
    mockCalculateNextRunTime.mockReturnValue(new Date())
    mockValidateCronExpression.mockReturnValue({ isValid: true })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

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

    const response = await POST(req)

    expect(response).toBeDefined()
    expect(response.status).toBe(200)

    const responseData = await response.json()
    expect(responseData).toHaveProperty('message', 'Schedule updated')
    expect(responseData).toHaveProperty('cronExpression', '0 9 * * *')
    expect(responseData).toHaveProperty('nextRunAt')
  })

  it('should handle errors gracefully', async () => {
    mockSelectLimit.mockReturnValue([])

    const req = createMockRequest('POST', {
      workflowId: 'workflow-id',
      state: { blocks: {}, edges: [], loops: {} },
    })

    const response = await POST(req)

    expect(response.status).toBeGreaterThanOrEqual(400)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  it('should require authentication', async () => {
    mockGetSession.mockResolvedValue(null)

    const req = createMockRequest('POST', {
      workflowId: 'workflow-id',
      state: { blocks: {}, edges: [], loops: {} },
    })

    const response = await POST(req)

    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data).toHaveProperty('error', 'Unauthorized')
  })

  it('should validate input data', async () => {
    const req = createMockRequest('POST', {
      workflowId: 'workflow-id',
    })

    const response = await POST(req)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data).toHaveProperty('error', 'Invalid request data')
  })
})
