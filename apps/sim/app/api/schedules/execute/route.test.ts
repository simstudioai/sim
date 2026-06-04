/**
 * Integration tests for scheduled workflow execution API route
 *
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, requestUtilsMockFns, resetDbChainMock } from '@sim/testing'
import { type NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const orderByLimitMock = vi.fn()

const {
  mockVerifyCronAuth,
  mockExecuteScheduleJob,
  mockExecuteJobInline,
  mockReleaseScheduleLock,
  mockFeatureFlags,
  mockEnqueue,
  mockGetJob,
  mockStartJob,
  mockCompleteJob,
  mockMarkJobFailed,
  mockCancelJob,
  mockShouldExecuteInline,
} = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn().mockReturnValue(null),
  mockExecuteScheduleJob: vi.fn().mockResolvedValue(undefined),
  mockExecuteJobInline: vi.fn().mockResolvedValue(undefined),
  mockReleaseScheduleLock: vi.fn().mockResolvedValue(undefined),
  mockFeatureFlags: {
    isTriggerDevEnabled: false,
    isHosted: false,
    isProd: false,
    isDev: true,
  },
  mockEnqueue: vi.fn().mockResolvedValue('job-id-1'),
  mockGetJob: vi.fn().mockResolvedValue(null),
  mockStartJob: vi.fn().mockResolvedValue(undefined),
  mockCompleteJob: vi.fn().mockResolvedValue(undefined),
  mockMarkJobFailed: vi.fn().mockResolvedValue(undefined),
  mockCancelJob: vi.fn().mockResolvedValue(undefined),
  mockShouldExecuteInline: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyCronAuth: mockVerifyCronAuth,
}))

vi.mock('@/background/schedule-execution', () => ({
  executeScheduleJob: mockExecuteScheduleJob,
  executeJobInline: mockExecuteJobInline,
  releaseScheduleLock: mockReleaseScheduleLock,
  buildScheduleFailureUpdate: (now: Date, nextRunAt: Date | null) => ({
    updatedAt: now,
    lastQueuedAt: null,
    nextRunAt,
    failedCount: { type: 'sql' },
    lastFailedAt: now,
    status: { type: 'sql' },
    infraRetryCount: 0,
  }),
}))

vi.mock('@/lib/core/config/feature-flags', () => mockFeatureFlags)

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn().mockResolvedValue({
    enqueue: mockEnqueue,
    getJob: mockGetJob,
    startJob: mockStartJob,
    completeJob: mockCompleteJob,
    markJobFailed: mockMarkJobFailed,
    cancelJob: mockCancelJob,
  }),
  shouldExecuteInline: mockShouldExecuteInline,
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  ne: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'ne' })),
  lte: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'lte' })),
  lt: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'lt' })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values, type: 'inArray' })),
  not: vi.fn((condition: unknown) => ({ type: 'not', condition })),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
  or: vi.fn((...conditions: unknown[]) => ({ type: 'or', conditions })),
  asc: vi.fn((field: unknown) => ({ type: 'asc', field })),
  sql: vi.fn((strings: unknown, ...values: unknown[]) => ({ type: 'sql', strings, values })),
}))

vi.mock('@sim/db', () => ({
  ...dbChainMock,
  workflowSchedule: {
    id: 'id',
    workflowId: 'workflowId',
    blockId: 'blockId',
    cronExpression: 'cronExpression',
    lastRanAt: 'lastRanAt',
    failedCount: 'failedCount',
    infraRetryCount: 'infraRetryCount',
    status: 'status',
    timezone: 'timezone',
    nextRunAt: 'nextRunAt',
    lastQueuedAt: 'lastQueuedAt',
    deploymentVersionId: 'deploymentVersionId',
    sourceType: 'sourceType',
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
  asyncJobs: {
    id: 'id',
    type: 'type',
    payload: 'payload',
    status: 'status',
    createdAt: 'createdAt',
    runAt: 'runAt',
    startedAt: 'startedAt',
    completedAt: 'completedAt',
    attempts: 'attempts',
    maxAttempts: 'maxAttempts',
    error: 'error',
    updatedAt: 'updatedAt',
  },
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'schedule-execution-1'),
  generateShortId: vi.fn(() => 'mock-short-id'),
  isValidUuid: vi.fn((v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ),
}))

import { GET, runScheduleTick } from './route'

const SINGLE_SCHEDULE = [
  {
    id: 'schedule-1',
    workflowId: 'workflow-1',
    blockId: null,
    cronExpression: null,
    lastRanAt: null,
    failedCount: 0,
    infraRetryCount: 0,
    timezone: 'UTC',
    nextRunAt: new Date('2025-01-01T00:00:00.000Z'),
    lastQueuedAt: undefined,
    workspaceId: 'workspace-1',
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
    infraRetryCount: 0,
    timezone: 'UTC',
    nextRunAt: new Date('2025-01-01T01:00:00.000Z'),
    lastQueuedAt: undefined,
    workspaceId: 'workspace-2',
  },
]

const SINGLE_CLAIMED_SCHEDULE_ROWS = [{ id: 'schedule-1', workspaceId: 'workspace-1' }]

const SINGLE_JOB = [
  {
    id: 'job-1',
    cronExpression: '0 * * * *',
    failedCount: 0,
    infraRetryCount: 0,
    timezone: 'UTC',
    lastQueuedAt: undefined,
    sourceType: 'job',
  },
]

function conditionContains(
  condition: unknown,
  predicate: (entry: Record<string, unknown>) => boolean
): boolean {
  if (!condition || typeof condition !== 'object') return false
  if (Array.isArray(condition)) {
    return condition.some((item) => conditionContains(item, predicate))
  }

  const entry = condition as Record<string, unknown>
  if (predicate(entry)) return true

  return Object.values(entry).some((value) => conditionContains(value, predicate))
}

function isActiveScheduleExecutionCountCondition(condition: unknown): boolean {
  return (
    conditionContains(
      condition,
      (entry) =>
        entry.type === 'eq' && entry.field === 'type' && entry.value === 'schedule-execution'
    ) &&
    conditionContains(
      condition,
      (entry) => entry.type === 'eq' && entry.field === 'status' && entry.value === 'processing'
    ) &&
    !conditionContains(condition, (entry) => entry.type === 'or')
  )
}

function mockProcessingCounts(...counts: number[]) {
  const defaultWhere = dbChainMockFns.where.getMockImplementation()
  if (!defaultWhere) throw new Error('Expected default where mock implementation')
  let index = 0

  dbChainMockFns.where.mockImplementation((condition: unknown) => {
    if (isActiveScheduleExecutionCountCondition(condition) && index < counts.length) {
      const count = counts[index]
      index += 1
      return Promise.resolve([{ count }]) as ReturnType<typeof dbChainMockFns.where>
    }

    return defaultWhere(condition)
  })
}

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
    dbChainMockFns.limit.mockReset()
    dbChainMockFns.returning.mockReset()
    dbChainMockFns.execute.mockReset()
    orderByLimitMock.mockReset()
    orderByLimitMock.mockResolvedValue([])
    resetDbChainMock()
    dbChainMockFns.orderBy.mockReturnValue({ limit: orderByLimitMock } as never)
    dbChainMockFns.execute.mockResolvedValue([{ acquired: true }] as never)
    requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('test-request-id')
    mockFeatureFlags.isTriggerDevEnabled = false
    mockFeatureFlags.isHosted = false
    mockFeatureFlags.isProd = false
    mockFeatureFlags.isDev = true
    mockShouldExecuteInline.mockReturnValue(false)
    mockEnqueue.mockReset()
    mockEnqueue.mockResolvedValue('job-id-1')
    mockGetJob.mockReset()
    mockGetJob.mockResolvedValue(null)
    mockStartJob.mockReset()
    mockStartJob.mockResolvedValue(undefined)
    mockCompleteJob.mockReset()
    mockCompleteJob.mockResolvedValue(undefined)
    mockMarkJobFailed.mockReset()
    mockMarkJobFailed.mockResolvedValue(undefined)
    mockCancelJob.mockReset()
    mockCancelJob.mockResolvedValue(undefined)
    mockExecuteScheduleJob.mockReset()
    mockExecuteScheduleJob.mockResolvedValue(undefined)
    mockExecuteJobInline.mockReset()
    mockExecuteJobInline.mockResolvedValue(undefined)
    mockReleaseScheduleLock.mockReset()
    mockReleaseScheduleLock.mockResolvedValue(undefined)
    dbChainMockFns.returning.mockReturnValue([])
  })

  it('should execute scheduled workflows with Trigger.dev disabled', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce(SINGLE_SCHEDULE).mockReturnValueOnce([])

    const result = await runScheduleTick('test-request-id')

    expect(result.processedCount).toBe(1)
  })

  it('should queue schedules to Trigger.dev when enabled', async () => {
    mockFeatureFlags.isTriggerDevEnabled = true
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce(SINGLE_SCHEDULE).mockReturnValueOnce([])

    const result = await runScheduleTick('test-request-id')

    expect(result.processedCount).toBe(1)
  })

  it('should handle case with no due schedules', async () => {
    dbChainMockFns.returning.mockReturnValueOnce([]).mockReturnValueOnce([])

    const result = await runScheduleTick('test-request-id')

    expect(result.processedCount).toBe(0)
  })

  it('should execute multiple schedules in parallel', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        { id: 'schedule-1', workspaceId: 'workspace-1' },
        { id: 'schedule-2', workspaceId: 'workspace-2' },
      ])
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce(MULTIPLE_SCHEDULES).mockReturnValueOnce([])

    const result = await runScheduleTick('test-request-id')

    expect(result.processedCount).toBe(2)
  })

  it('should execute mothership jobs inline', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'job-1' }])
    dbChainMockFns.returning.mockReturnValueOnce(SINGLE_JOB)

    await runScheduleTick('test-request-id')
    expect(mockExecuteJobInline).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'job-1',
        cronExpression: '0 * * * *',
        failedCount: 0,
        now: expect.any(String),
      })
    )
  })

  it('should enqueue schedule with correlation metadata via job queue', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce(SINGLE_SCHEDULE).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')
    expect(mockEnqueue).toHaveBeenCalledWith(
      'schedule-execution',
      expect.objectContaining({
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        executionId: 'schedule-execution-1',
        requestId: 'test-request-id',
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^schedule_[0-9a-f]{32}$/),
        metadata: expect.objectContaining({
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          correlation: expect.objectContaining({
            executionId: 'schedule-execution-1',
            requestId: 'test-request-id',
            source: 'schedule',
            workflowId: 'workflow-1',
            scheduleId: 'schedule-1',
          }),
        }),
      })
    )
    expect(mockEnqueue.mock.calls[0][2].concurrencyKey).toBeUndefined()
  })

  it('executes database fallback schedules through durable async job rows', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning
      .mockReturnValueOnce(SINGLE_SCHEDULE)
      .mockResolvedValueOnce([{ id: 'job-id-1' }])

    try {
      await runScheduleTick('test-request-id')
      expect(mockEnqueue).toHaveBeenCalledWith(
        'schedule-execution',
        expect.objectContaining({ scheduleId: 'schedule-1' }),
        expect.objectContaining({
          jobId: expect.stringMatching(/^schedule_[0-9a-f]{32}$/),
          metadata: expect.objectContaining({
            workflowId: 'workflow-1',
            workspaceId: 'workspace-1',
          }),
        })
      )
      expect(mockStartJob).not.toHaveBeenCalled()
      expect(mockExecuteScheduleJob).toHaveBeenCalledWith(
        expect.objectContaining({ scheduleId: 'schedule-1' })
      )
      expect(mockCompleteJob).toHaveBeenCalledWith('job-id-1', null)
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('releases database fallback claims when the global concurrency cap is full', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    mockProcessingCounts(0, 0, 50)
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning
      .mockReturnValueOnce([{ ...SINGLE_SCHEDULE[0], lastQueuedAt: claimedAt }])
      .mockResolvedValueOnce([])

    try {
      await runScheduleTick('test-request-id')
      expect(mockEnqueue).toHaveBeenCalled()
      expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
      expect(mockCompleteJob).not.toHaveBeenCalled()
      expect(mockReleaseScheduleLock).not.toHaveBeenCalled()
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('recovers stale database fallback processing jobs before resuming them', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const staleStartedAt = new Date('2024-12-31T00:00:00.000Z')
    mockProcessingCounts(0, 0)
    mockGetJob
      .mockResolvedValueOnce({
        id: 'job-id-1',
        status: 'processing',
        startedAt: staleStartedAt,
      })
      .mockResolvedValueOnce({
        id: 'job-id-1',
        status: 'pending',
      })
    orderByLimitMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'job-id-1',
          payload: {
            scheduleId: 'schedule-1',
            workflowId: 'workflow-1',
            now: '2025-01-01T00:00:00.000Z',
          },
          attempts: 0,
          maxAttempts: 3,
        },
      ])
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning
      .mockReturnValueOnce([{ ...SINGLE_SCHEDULE[0], lastQueuedAt: new Date('2025-01-01') }])
      .mockResolvedValueOnce([{ id: 'job-id-1' }])

    try {
      await runScheduleTick('test-request-id')
      expect(mockExecuteScheduleJob).toHaveBeenCalledWith(
        expect.objectContaining({ scheduleId: 'schedule-1' })
      )
      expect(mockCompleteJob).toHaveBeenCalledWith(
        expect.stringMatching(/^schedule_[0-9a-f]{32}$/),
        null
      )
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          startedAt: null,
          error: expect.stringContaining('stale schedule execution processing lease'),
        })
      )
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('resumes pending database fallback jobs without waiting for a stale schedule claim', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    mockProcessingCounts(0, 0, 0)
    orderByLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'pending-job-id',
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          now: claimedAt.toISOString(),
        },
      },
    ])
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ lastQueuedAt: claimedAt }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'pending-job-id' }])

    const result = await runScheduleTick('test-request-id')

    expect(result.processedCount).toBe(1)
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockExecuteScheduleJob).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        now: claimedAt.toISOString(),
      })
    )
    expect(mockCompleteJob).toHaveBeenCalledWith('pending-job-id', null)
  })

  it('completes stale pending database fallback jobs whose schedule claim was already released', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'stale-pending-job-id',
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          now: claimedAt.toISOString(),
        },
      },
    ])
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ lastQueuedAt: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
    expect(mockCompleteJob).toHaveBeenCalledWith(
      'stale-pending-job-id',
      expect.objectContaining({
        skipped: true,
      })
    )
  })

  it('fails exhausted stale database fallback jobs instead of retrying forever', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([
      {
        id: 'exhausted-job-id',
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          now: claimedAt.toISOString(),
        },
        attempts: 3,
        maxAttempts: 3,
      },
    ])
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await runScheduleTick('test-request-id')
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('exhausted retry attempts'),
      })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: null,
        lastFailedAt: expect.any(Date),
        nextRunAt: expect.any(Date),
      })
    )
  })

  it('defers schedule claims when retryable lookup infrastructure fails before enqueue', async () => {
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: claimedAt,
    }
    mockGetJob.mockRejectedValueOnce(
      Object.assign(new Error('queue lookup failed'), { code: 'ECONNRESET' })
    )
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockReleaseScheduleLock).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: null,
        nextRunAt: expect.any(Date),
        infraRetryCount: 1,
      })
    )
  })

  it('marks schedules failed when non-retryable setup errors happen before enqueue', async () => {
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: claimedAt,
    }
    mockGetJob.mockRejectedValueOnce(new Error('bad setup invariant'))
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: null,
        lastFailedAt: expect.any(Date),
        nextRunAt: expect.any(Date),
        infraRetryCount: 0,
      })
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({
        infraRetryCount: 1,
      })
    )
  })

  it('uses one backend mode decision for slot accounting and schedule processing', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning
      .mockReturnValueOnce(SINGLE_SCHEDULE)
      .mockResolvedValueOnce([{ id: 'job-id-1' }])

    try {
      await runScheduleTick('test-request-id')
      expect(mockShouldExecuteInline).toHaveBeenCalledTimes(1)
      expect(mockExecuteScheduleJob).toHaveBeenCalledWith(
        expect.objectContaining({ scheduleId: 'schedule-1' })
      )
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('restores the original claim token when an active durable job owns the occurrence', async () => {
    const originalClaim = new Date()
    const staleReclaim = new Date(originalClaim.getTime() + 60_000)
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: staleReclaim,
    }
    mockGetJob.mockResolvedValueOnce({
      id: 'job-id-1',
      status: 'processing',
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        now: originalClaim.toISOString(),
      },
    })
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockReleaseScheduleLock).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: originalClaim,
      })
    )
  })

  it('does not restore stale database fallback claims for fresh processing jobs', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const originalClaim = new Date('2024-01-01T00:00:00.000Z')
    const staleReclaim = new Date()
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: staleReclaim,
    }
    mockGetJob
      .mockResolvedValueOnce({
        id: 'job-id-1',
        status: 'processing',
        startedAt: new Date(),
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          now: originalClaim.toISOString(),
        },
      })
      .mockResolvedValueOnce({
        id: 'job-id-1',
        status: 'processing',
        startedAt: new Date(),
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          now: originalClaim.toISOString(),
        },
      })
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([schedule])
      .mockReturnValueOnce([])

    await runScheduleTick('test-request-id')
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: originalClaim,
      })
    )
  })

  it('restores the original claim token when Trigger.dev returns an idempotent existing run', async () => {
    const originalClaim = new Date()
    const staleReclaim = new Date(originalClaim.getTime() + 60_000)
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: staleReclaim,
    }
    mockEnqueue.mockResolvedValueOnce('trigger-run-id')
    mockGetJob.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'trigger-run-id',
      status: 'processing',
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        now: originalClaim.toISOString(),
      },
    })
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')
    expect(mockEnqueue).toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: originalClaim,
      })
    )
  })

  it('cancels stale Trigger.dev runs instead of restoring an expired claim forever', async () => {
    const originalClaim = new Date('2024-01-01T00:00:00.000Z')
    const staleReclaim = new Date()
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: staleReclaim,
    }
    mockEnqueue.mockResolvedValueOnce('trigger-run-id')
    mockGetJob.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'trigger-run-id',
      status: 'processing',
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        now: originalClaim.toISOString(),
      },
    })
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')
    expect(mockCancelJob).toHaveBeenCalledWith('trigger-run-id')
    expect(mockReleaseScheduleLock).toHaveBeenCalledWith(
      'schedule-1',
      'test-request-id',
      expect.any(Date),
      expect.stringContaining('cancelling stale queued schedule execution job'),
      undefined,
      { expectedLastQueuedAt: staleReclaim }
    )
  })

  it('bounds workflow schedule claims to the configured enqueue budget', async () => {
    const claimedIds = Array.from({ length: 100 }, (_, index) => ({
      id: `schedule-${index}`,
      workspaceId: `workspace-${index}`,
    }))
    const claimedSchedules = claimedIds.map((row, index) => ({
      id: row.id,
      workflowId: `workflow-${index}`,
      blockId: null,
      cronExpression: null,
      lastRanAt: null,
      failedCount: 0,
      infraRetryCount: 0,
      timezone: 'UTC',
      nextRunAt: new Date('2025-01-01T00:00:00.000Z'),
      lastQueuedAt: undefined,
      workspaceId: row.workspaceId,
    }))

    dbChainMockFns.limit.mockResolvedValueOnce(claimedIds).mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce(claimedSchedules).mockReturnValueOnce([])

    const result = await runScheduleTick('test-request-id')

    expect(result.processedCount).toBe(100)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(100)
    expect(mockEnqueue).toHaveBeenCalledTimes(100)
  })

  it('guards route-side stale release updates with the claimed occurrence', async () => {
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: claimedAt,
    }
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])
    mockGetJob.mockResolvedValueOnce({ id: 'job-id-1', status: 'completed' })

    await runScheduleTick('test-request-id')
    expect(mockReleaseScheduleLock).toHaveBeenCalledWith(
      'schedule-1',
      'test-request-id',
      expect.any(Date),
      expect.stringContaining('finished job'),
      null,
      { expectedLastQueuedAt: claimedAt }
    )
  })

  describe('GET handler (fire-and-forget)', () => {
    it('returns the auth error when cron auth fails', async () => {
      mockVerifyCronAuth.mockReturnValueOnce(
        NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      )

      const response = await GET(createMockRequest())

      expect(response.status).toBe(401)
    })

    it('acknowledges immediately with 202 and starts the tick in the background', async () => {
      const response = await GET(createMockRequest())

      expect(response.status).toBe(202)
      const data = await response.json()
      expect(data).toMatchObject({ status: 'started' })
    })
  })
})
