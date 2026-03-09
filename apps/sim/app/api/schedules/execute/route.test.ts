/**
 * Integration tests for scheduled workflow execution API route
 *
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockVerifyCronAuth,
  mockExecuteScheduleJob,
  mockFeatureFlags,
  mockDbReturning,
  mockDbUpdate,
  mockEnqueue,
  mockStartJob,
  mockCompleteJob,
  mockMarkJobFailed,
} = vi.hoisted(() => {
  const mockDbReturning = vi.fn().mockReturnValue([])
  const mockDbWhere = vi.fn().mockReturnValue({ returning: mockDbReturning })
  const mockDbSet = vi.fn().mockReturnValue({ where: mockDbWhere })
  const mockDbUpdate = vi.fn().mockReturnValue({ set: mockDbSet })
  const mockEnqueue = vi.fn().mockResolvedValue('job-id-1')
  const mockStartJob = vi.fn().mockResolvedValue(undefined)
  const mockCompleteJob = vi.fn().mockResolvedValue(undefined)
  const mockMarkJobFailed = vi.fn().mockResolvedValue(undefined)

  return {
    mockVerifyCronAuth: vi.fn().mockReturnValue(null),
    mockExecuteScheduleJob: vi.fn().mockResolvedValue(undefined),
    mockFeatureFlags: {
      isTriggerDevEnabled: false,
      isHosted: false,
      isProd: false,
      isDev: true,
    },
    mockDbReturning,
    mockDbUpdate,
    mockEnqueue,
    mockStartJob,
    mockCompleteJob,
    mockMarkJobFailed,
  }
})

vi.mock('@/lib/auth/internal', () => ({
  verifyCronAuth: mockVerifyCronAuth,
}))

vi.mock('@/background/schedule-execution', () => ({
  executeScheduleJob: mockExecuteScheduleJob,
}))

vi.mock('@/lib/core/config/feature-flags', () => mockFeatureFlags)

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('test-request-id'),
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn().mockResolvedValue({
    enqueue: mockEnqueue,
    startJob: mockStartJob,
    completeJob: mockCompleteJob,
    markJobFailed: mockMarkJobFailed,
  }),
  shouldExecuteInline: vi.fn().mockReturnValue(false),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  lte: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'lte' })),
  lt: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'lt' })),
  not: vi.fn((condition: unknown) => ({ type: 'not', condition })),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
  or: vi.fn((...conditions: unknown[]) => ({ type: 'or', conditions })),
  sql: vi.fn((strings: unknown, ...values: unknown[]) => ({ type: 'sql', strings, values })),
}))

vi.mock('@sim/db', () => ({
  db: {
    update: mockDbUpdate,
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
    deploymentVersionId: 'deploymentVersionId',
  },
  workflowDeploymentVersion: {
    id: 'id',
    workflowId: 'workflowId',
    isActive: 'isActive',
  },
  workflow: {
    id: 'id',
    userId: 'userId',
    workspaceId: 'workspaceId',
  },
}))

import { GET } from '@/app/api/schedules/execute/route'

const SINGLE_SCHEDULE = [
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

const MULTIPLE_SCHEDULES = [
  ...SINGLE_SCHEDULE,
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
    mockFeatureFlags.isTriggerDevEnabled = false
    mockFeatureFlags.isHosted = false
    mockFeatureFlags.isProd = false
    mockFeatureFlags.isDev = true
    mockDbReturning.mockReturnValue([])
  })

  it('should execute scheduled workflows with Trigger.dev disabled', async () => {
    mockDbReturning.mockReturnValue(SINGLE_SCHEDULE)

    const response = await GET(createMockRequest())

    expect(response).toBeDefined()
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('message')
    expect(data).toHaveProperty('executedCount', 1)
  })

  it('should queue schedules to Trigger.dev when enabled', async () => {
    mockFeatureFlags.isTriggerDevEnabled = true
    mockDbReturning.mockReturnValue(SINGLE_SCHEDULE)

    const response = await GET(createMockRequest())

    expect(response).toBeDefined()
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('executedCount', 1)
  })

  it('should handle case with no due schedules', async () => {
    mockDbReturning.mockReturnValue([])

    const response = await GET(createMockRequest())

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('message')
    expect(data).toHaveProperty('executedCount', 0)
  })

  it('should execute multiple schedules in parallel', async () => {
    mockDbReturning.mockReturnValue(MULTIPLE_SCHEDULES)

    const response = await GET(createMockRequest())

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('executedCount', 2)
  })
})
