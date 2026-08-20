/**
 * Integration tests for scheduled workflow execution API route
 *
 * @vitest-environment node
 */
import {
  createMockSql,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  requestUtilsMockFns,
  resetDbChainMock,
  resetEnvFlagsMock,
  resetEnvMock,
  setEnv,
  setEnvFlags,
} from '@sim/testing'
import { type NextRequest, NextResponse } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncJobEnqueueError } from '@/lib/core/async-jobs/types'

const orderByLimitMock = vi.fn()

const {
  mockVerifyCronAuth,
  mockExecuteScheduleJob,
  mockReleaseScheduleLock,
  mockEnqueue,
  mockGetJob,
  mockStartJob,
  mockCompleteJob,
  mockMarkJobFailed,
  mockCancelJob,
  mockShouldExecuteInline,
  mockResolveSystemBillingAttribution,
  mockAssertBillingAttributionSnapshot,
  mockApplyScheduleSuccessUpdate,
  mockApplyScheduleCancellationUpdate,
  mockApplyScheduleFailureUpdate,
  mockNotifyScheduleAutoDisabled,
  mockRegisterManualExecutionAborter,
  mockUnregisterManualExecutionAborter,
  mockAsyncJobs,
  mockWorkflowSchedule,
  mockWorkflowExecutionLogs,
} = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn().mockReturnValue(null),
  mockExecuteScheduleJob: vi.fn().mockResolvedValue(undefined),
  mockReleaseScheduleLock: vi.fn().mockResolvedValue(undefined),
  mockEnqueue: vi.fn().mockResolvedValue('job-id-1'),
  mockGetJob: vi.fn().mockResolvedValue(null),
  mockStartJob: vi.fn().mockResolvedValue(undefined),
  mockCompleteJob: vi.fn().mockResolvedValue(undefined),
  mockMarkJobFailed: vi.fn().mockResolvedValue(undefined),
  mockCancelJob: vi.fn().mockResolvedValue(undefined),
  mockShouldExecuteInline: vi.fn().mockReturnValue(false),
  mockResolveSystemBillingAttribution: vi.fn(),
  mockAssertBillingAttributionSnapshot: vi.fn(),
  mockApplyScheduleSuccessUpdate: vi.fn().mockResolvedValue(true),
  mockApplyScheduleCancellationUpdate: vi.fn().mockResolvedValue(true),
  mockApplyScheduleFailureUpdate: vi.fn().mockResolvedValue({ updated: true, disabled: false }),
  mockNotifyScheduleAutoDisabled: vi.fn().mockResolvedValue(undefined),
  mockRegisterManualExecutionAborter: vi.fn(),
  mockUnregisterManualExecutionAborter: vi.fn(),
  mockAsyncJobs: {
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
    output: 'output',
    metadata: 'metadata',
    updatedAt: 'updatedAt',
  },
  mockWorkflowSchedule: {
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
    archivedAt: 'archivedAt',
    deploymentVersionId: 'deploymentVersionId',
    sourceType: 'sourceType',
  },
  mockWorkflowExecutionLogs: {
    executionId: 'executionId',
    workflowId: 'workflowId',
    status: 'status',
  },
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyCronAuth: mockVerifyCronAuth,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: mockAssertBillingAttributionSnapshot,
  resolveSystemBillingAttribution: mockResolveSystemBillingAttribution,
}))

vi.mock('@/background/schedule-execution', () => ({
  executeScheduleJob: mockExecuteScheduleJob,
  releaseScheduleLock: mockReleaseScheduleLock,
  applyScheduleSuccessUpdate: mockApplyScheduleSuccessUpdate,
  applyScheduleCancellationUpdate: mockApplyScheduleCancellationUpdate,
  applyScheduleFailureUpdate: mockApplyScheduleFailureUpdate,
}))

vi.mock('@/lib/workflows/schedules/disable-notifications', () => ({
  notifyScheduleAutoDisabled: mockNotifyScheduleAutoDisabled,
}))

vi.mock('@/lib/execution/manual-cancellation', () => ({
  registerManualExecutionAborter: mockRegisterManualExecutionAborter,
  unregisterManualExecutionAborter: mockUnregisterManualExecutionAborter,
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn().mockResolvedValue({
    enqueue: mockEnqueue,
    getJob: mockGetJob,
    startJob: mockStartJob,
    completeJob: mockCompleteJob,
    markJobFailed: mockMarkJobFailed,
    cancelJob: mockCancelJob,
  }),
  JOB_PENDING_RETENTION_HOURS: 14 * 24,
  shouldExecuteInline: mockShouldExecuteInline,
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  gt: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'gt' })),
  ne: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'ne' })),
  lte: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'lte' })),
  lt: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'lt' })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values, type: 'inArray' })),
  not: vi.fn((condition: unknown) => ({ type: 'not', condition })),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
  or: vi.fn((...conditions: unknown[]) => ({ type: 'or', conditions })),
  asc: vi.fn((field: unknown) => ({ type: 'asc', field })),
  sql: createMockSql(),
}))

vi.mock('@sim/db', () => ({
  ...dbChainMock,
  workflowSchedule: mockWorkflowSchedule,
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
  asyncJobs: mockAsyncJobs,
  workflowExecutionLogs: mockWorkflowExecutionLogs,
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'schedule-execution-1'),
  generateShortId: vi.fn(() => 'mock-short-id'),
  isValidUuid: vi.fn((v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ),
}))

vi.mock('@sim/utils/random', () => ({
  randomInt: vi.fn(() => 0),
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

function createBillingAttribution(workspaceId: string, actorUserId = `owner-${workspaceId}`) {
  return {
    actorUserId,
    workspaceId,
    organizationId: 'org-1',
    billedAccountUserId: `owner-${workspaceId}`,
    billingEntity: { type: 'organization', id: 'org-1' },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    payerSubscription: null,
  }
}

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

afterAll(() => {
  resetEnvFlagsMock()
  resetEnvMock()
})

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
    setEnvFlags({ isTriggerDevEnabled: false, isHosted: false, isProd: false, isDev: true })
    // Prompt-job claims are skipped without the mothership credential; pin it so
    // these cases do not depend on whether the runner happens to have a .env.
    setEnv({ COPILOT_API_KEY: 'test-api-key' })
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
    mockReleaseScheduleLock.mockReset()
    mockReleaseScheduleLock.mockResolvedValue(undefined)
    mockApplyScheduleSuccessUpdate.mockReset()
    mockApplyScheduleSuccessUpdate.mockResolvedValue(true)
    mockApplyScheduleCancellationUpdate.mockReset()
    mockApplyScheduleCancellationUpdate.mockResolvedValue(true)
    mockApplyScheduleFailureUpdate.mockReset()
    mockApplyScheduleFailureUpdate.mockResolvedValue({ updated: true, disabled: false })
    mockAssertBillingAttributionSnapshot.mockReset()
    mockAssertBillingAttributionSnapshot.mockImplementation((value: unknown) => {
      if (!value || typeof value !== 'object') {
        throw new Error('Billing attribution snapshot must be an object')
      }
      return value
    })
    mockResolveSystemBillingAttribution.mockImplementation((workspaceId: string) =>
      Promise.resolve(createBillingAttribution(workspaceId))
    )
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
    setEnvFlags({ isTriggerDevEnabled: true })
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

  it('rotates deferred recovery carriers behind untouched work', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    dbChainMockFns.returning.mockReturnValueOnce([]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')

    expect(dbChainMockFns.orderBy).toHaveBeenCalledWith(
      { type: 'asc', field: mockAsyncJobs.updatedAt },
      { type: 'asc', field: mockAsyncJobs.id }
    )
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

  it('should enqueue schedule with one atomic system actor and payer snapshot', async () => {
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
        billingAttribution: expect.objectContaining({
          actorUserId: 'owner-workspace-1',
          workspaceId: 'workspace-1',
          billingEntity: { type: 'organization', id: 'org-1' },
        }),
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
    expect(mockResolveSystemBillingAttribution).toHaveBeenCalledWith('workspace-1')
    expect(mockResolveSystemBillingAttribution).toHaveBeenCalledTimes(1)
    expect(mockEnqueue.mock.calls[0][2].concurrencyKey).toBeUndefined()
  })

  it('executes database fallback schedules through durable async job rows', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning
      .mockReturnValueOnce(SINGLE_SCHEDULE)
      .mockResolvedValueOnce([{ id: 'job-id-1' }])

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
      expect.objectContaining({ scheduleId: 'schedule-1' }),
      expect.any(AbortSignal)
    )
    expect(mockRegisterManualExecutionAborter).toHaveBeenCalledWith(
      'schedule-execution-1',
      expect.any(Function)
    )
    expect(mockUnregisterManualExecutionAborter).toHaveBeenCalledWith('schedule-execution-1')
    expect(mockCompleteJob).toHaveBeenCalledWith('job-id-1', null)

    const authoritativeStartCondition = dbChainMockFns.where.mock.calls
      .map(([condition]) => condition)
      .find(
        (condition) =>
          conditionContains(
            condition,
            (entry) => entry.type === 'eq' && entry.field === mockAsyncJobs.id
          ) &&
          conditionContains(
            condition,
            (entry) =>
              entry.type === 'eq' &&
              entry.field === mockAsyncJobs.type &&
              entry.value === 'schedule-execution'
          ) &&
          conditionContains(
            condition,
            (entry) =>
              entry.type === 'eq' &&
              entry.field === mockAsyncJobs.status &&
              entry.value === 'pending'
          ) &&
          conditionContains(
            condition,
            (entry) =>
              entry.type === 'eq' && entry.field === mockAsyncJobs.attempts && entry.value === 0
          )
      )
    expect(authoritativeStartCondition).toBeDefined()
  })

  it('forwards database fallback cancellation into the schedule execution signal', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning
      .mockReturnValueOnce(SINGLE_SCHEDULE)
      .mockResolvedValueOnce([{ id: 'job-id-1' }])
    mockExecuteScheduleJob.mockImplementationOnce(
      async (_payload: unknown, signal: AbortSignal) => {
        const abort = mockRegisterManualExecutionAborter.mock.calls[0]?.[1]
        abort()
        expect(signal.aborted).toBe(true)
      }
    )

    await runScheduleTick('test-request-id')

    expect(mockUnregisterManualExecutionAborter).toHaveBeenCalledWith('schedule-execution-1')
  })

  it('releases database fallback claims when the global concurrency cap is full', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    mockProcessingCounts(0, 0, 50)
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning
      .mockReturnValueOnce([{ ...SINGLE_SCHEDULE[0], lastQueuedAt: claimedAt }])
      .mockResolvedValueOnce([])

    await runScheduleTick('test-request-id')
    expect(mockEnqueue).toHaveBeenCalled()
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
    expect(mockCompleteJob).not.toHaveBeenCalled()
    expect(mockReleaseScheduleLock).not.toHaveBeenCalled()
  })

  it.each([
    { persistedStatus: 'completed', accounting: 'success', carrierStatus: 'completed' },
    { persistedStatus: 'failed', accounting: 'failure', carrierStatus: 'completed' },
    { persistedStatus: 'cancelled', accounting: 'cancelled', carrierStatus: 'completed' },
    { persistedStatus: 'pending', accounting: 'success', carrierStatus: 'completed' },
    { persistedStatus: 'paused', accounting: 'success', carrierStatus: 'completed' },
  ])(
    'reconciles a stale database job from a $persistedStatus execution log',
    async ({ persistedStatus, accounting, carrierStatus }) => {
      mockShouldExecuteInline.mockReturnValue(true)
      const claimedAt = new Date('2025-01-01T00:00:00.000Z')
      const payload = {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        now: claimedAt.toISOString(),
      }
      mockProcessingCounts(0, 0)
      orderByLimitMock.mockResolvedValueOnce([
        { id: 'claimed-job-id', payload, status: 'processing' },
      ])
      queueTableRows(mockWorkflowExecutionLogs, [
        { executionId: 'execution-1', workflowId: 'workflow-1', status: persistedStatus },
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'claimed-job-id' }])

      await runScheduleTick('test-request-id')

      expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: carrierStatus,
          completedAt: expect.any(Date),
          output: expect.objectContaining({ executionStatus: persistedStatus }),
        })
      )
      if (accounting === 'failure') {
        expect(mockApplyScheduleFailureUpdate).toHaveBeenCalledOnce()
      } else if (accounting === 'cancelled') {
        expect(mockApplyScheduleCancellationUpdate).toHaveBeenCalledOnce()
      } else {
        expect(mockApplyScheduleSuccessUpdate).toHaveBeenCalledOnce()
      }
    }
  )

  it('preserves an already-cancelled database carrier while reconciling it', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([
      {
        id: 'cancelled-job-id',
        status: 'cancelled',
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          now: claimedAt.toISOString(),
          scheduledFor: claimedAt.toISOString(),
        },
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'cancelled-job-id' }])

    await runScheduleTick('test-request-id')

    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: expect.anything() })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.anything() })
    )
    expect(mockApplyScheduleCancellationUpdate).toHaveBeenCalledOnce()
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
  })

  it('preserves a cancelled carrier when its workflow log completed', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([
      {
        id: 'cancelled-job-id',
        status: 'cancelled',
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          now: claimedAt.toISOString(),
          scheduledFor: claimedAt.toISOString(),
        },
      },
    ])
    queueTableRows(mockWorkflowExecutionLogs, [
      { executionId: 'execution-1', workflowId: 'workflow-1', status: 'completed' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'cancelled-job-id' }])

    await runScheduleTick('test-request-id')

    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: expect.anything() })
    )
    expect(mockApplyScheduleSuccessUpdate).toHaveBeenCalledOnce()
    expect(mockApplyScheduleCancellationUpdate).not.toHaveBeenCalled()
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
  })

  it('marks a terminal carrier reconciled when its occurrence already advanced', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const nextOccurrence = new Date('2025-01-02T00:00:00.000Z')
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([
      {
        id: 'completed-job-id',
        status: 'completed',
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          now: claimedAt.toISOString(),
          scheduledFor: claimedAt.toISOString(),
        },
      },
    ])
    queueTableRows(mockWorkflowExecutionLogs, [
      { executionId: 'execution-1', workflowId: 'workflow-1', status: 'completed' },
    ])
    queueTableRows(mockWorkflowSchedule, [
      {
        archivedAt: null,
        lastQueuedAt: null,
        nextRunAt: nextOccurrence,
        status: 'active',
      },
    ])
    mockApplyScheduleSuccessUpdate.mockResolvedValueOnce(false)
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'completed-job-id' }])

    await runScheduleTick('test-request-id')

    expect(mockApplyScheduleSuccessUpdate).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.anything(), updatedAt: expect.any(Date) })
    )
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
  })

  it('restores a released claim before retrying terminal carrier accounting', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([
      {
        id: 'completed-job-id',
        status: 'completed',
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          now: claimedAt.toISOString(),
          scheduledFor: claimedAt.toISOString(),
        },
      },
    ])
    queueTableRows(mockWorkflowExecutionLogs, [
      { executionId: 'execution-1', workflowId: 'workflow-1', status: 'completed' },
    ])
    queueTableRows(mockWorkflowSchedule, [
      {
        archivedAt: null,
        lastQueuedAt: null,
        nextRunAt: claimedAt,
        status: 'active',
      },
    ])
    mockApplyScheduleSuccessUpdate.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'completed-job-id' }])
      .mockResolvedValueOnce([{ id: 'schedule-1' }])

    await runScheduleTick('test-request-id')

    expect(mockApplyScheduleSuccessUpdate).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastQueuedAt: claimedAt })
    )
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
  })

  it('does not overwrite a newer non-null claim while reconciling an old carrier', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const newerClaim = new Date('2025-01-01T00:05:00.000Z')
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([
      {
        id: 'completed-job-id',
        status: 'completed',
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          now: claimedAt.toISOString(),
          scheduledFor: claimedAt.toISOString(),
        },
      },
    ])
    queueTableRows(mockWorkflowExecutionLogs, [
      { executionId: 'execution-1', workflowId: 'workflow-1', status: 'completed' },
    ])
    queueTableRows(mockWorkflowSchedule, [
      {
        archivedAt: null,
        lastQueuedAt: newerClaim,
        nextRunAt: claimedAt,
        status: 'active',
      },
    ])
    mockApplyScheduleSuccessUpdate.mockResolvedValueOnce(false)
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'completed-job-id' }])

    await runScheduleTick('test-request-id')

    expect(mockApplyScheduleSuccessUpdate).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ lastQueuedAt: claimedAt })
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.anything() })
    )
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
  })

  it('rotates a deferred carrier to the back of the batch instead of starving it', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const newerClaim = new Date('2025-01-01T00:05:00.000Z')
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([
      {
        id: 'completed-job-id',
        status: 'completed',
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          now: claimedAt.toISOString(),
          scheduledFor: claimedAt.toISOString(),
        },
      },
    ])
    queueTableRows(mockWorkflowExecutionLogs, [
      { executionId: 'execution-1', workflowId: 'workflow-1', status: 'completed' },
    ])
    queueTableRows(mockWorkflowSchedule, [
      {
        archivedAt: null,
        lastQueuedAt: newerClaim,
        nextRunAt: claimedAt,
        status: 'active',
      },
    ])
    mockApplyScheduleSuccessUpdate.mockResolvedValueOnce(false)

    await runScheduleTick('test-request-id')

    const carrierWrites = dbChainMockFns.set.mock.calls
      .map(([values]) => values as Record<string, unknown>)
      .filter((values) => values.updatedAt instanceof Date)

    expect(carrierWrites).toContainEqual({ updatedAt: expect.any(Date) })
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.anything() })
    )
  })

  it('marks malformed terminal carriers irrecoverable so they leave the recovery batch', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([
      {
        id: 'malformed-job-id',
        status: 'completed',
        payload: { workflowId: 'workflow-1' },
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'malformed-job-id' }])

    await runScheduleTick('test-request-id')

    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: expect.anything() })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.anything(), updatedAt: expect.any(Date) })
    )
    expect(mockApplyScheduleFailureUpdate).not.toHaveBeenCalled()
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
  })

  it('settles a malformed in-flight carrier before marking it irrecoverable', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([
      {
        id: 'malformed-job-id',
        status: 'processing',
        payload: { workflowId: 'workflow-1' },
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'malformed-job-id' }])

    await runScheduleTick('test-request-id')

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', completedAt: expect.any(Date) })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.anything(), updatedAt: expect.any(Date) })
    )
    expect(mockApplyScheduleFailureUpdate).not.toHaveBeenCalled()
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'a missing execution log', executionId: 'execution-1', persistedStatus: null },
    { name: 'a missing execution ID', executionId: undefined, persistedStatus: null },
    { name: 'a stale running log', executionId: 'execution-1', persistedStatus: 'running' },
    { name: 'a stale redacting log', executionId: 'execution-1', persistedStatus: 'redacting' },
  ])('fails a claimed database job with $name without rerunning it', async (testCase) => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([
      {
        id: 'claimed-job-id',
        status: 'processing',
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          executionId: testCase.executionId,
          now: claimedAt.toISOString(),
        },
      },
    ])
    if (testCase.persistedStatus) {
      queueTableRows(mockWorkflowExecutionLogs, [
        {
          executionId: 'execution-1',
          workflowId: 'workflow-1',
          status: testCase.persistedStatus,
        },
      ])
    }
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'claimed-job-id' }])

    await runScheduleTick('test-request-id')

    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('Indeterminate schedule execution outcome'),
      })
    )
    expect(mockApplyScheduleFailureUpdate).toHaveBeenCalledOnce()
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
          workspaceId: 'workspace-1',
          billingAttribution: createBillingAttribution('workspace-1'),
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
      }),
      expect.any(AbortSignal)
    )
    expect(mockCompleteJob).toHaveBeenCalledWith('pending-job-id', null)
    expect(
      dbChainMockFns.where.mock.calls.some(([condition]) =>
        conditionContains(
          condition,
          (entry) => entry.type === 'eq' && entry.field === 'attempts' && entry.value === 0
        )
      )
    ).toBe(true)
  })

  it.each([
    {
      name: 'a missing workspace',
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        billingAttribution: createBillingAttribution('workspace-1'),
      },
      expectedError: 'Invalid pending schedule execution payload: workspaceId is required',
    },
    {
      name: 'missing billing attribution',
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      expectedError: 'Invalid pending schedule execution payload: billingAttribution is required',
    },
    {
      name: 'billing attribution for another workspace',
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        billingAttribution: createBillingAttribution('workspace-2'),
      },
      expectedError:
        'Invalid pending schedule execution payload: billing attribution workspace does not match payload workspace',
    },
    {
      name: 'billing attribution for a different system actor',
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        billingAttribution: createBillingAttribution('workspace-1', 'member-1'),
      },
      expectedError:
        'Invalid pending schedule execution payload: billing attribution actor does not match billed account',
    },
  ])('rejects pending database fallback jobs with $name', async ({ payload, expectedError }) => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'pending-job-id',
        payload: {
          ...payload,
          now: claimedAt.toISOString(),
        },
      },
    ])
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ lastQueuedAt: claimedAt }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await runScheduleTick('test-request-id')

    expect(result.processedCount).toBe(1)
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
    expect(mockMarkJobFailed).toHaveBeenCalledWith('pending-job-id', expectedError)
    expect(mockReleaseScheduleLock).toHaveBeenCalledWith(
      'schedule-1',
      'test-request-id',
      expect.any(Date),
      expect.stringContaining('invalid pending schedule execution payload'),
      undefined,
      { expectedLastQueuedAt: claimedAt }
    )
  })

  it('rejects pending database fallback jobs with malformed billing attribution', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    mockProcessingCounts(0, 0)
    mockAssertBillingAttributionSnapshot.mockImplementationOnce(() => {
      throw new Error('Billing attribution snapshot is missing its billing entity')
    })
    orderByLimitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'pending-job-id',
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          billingAttribution: {},
          now: claimedAt.toISOString(),
        },
      },
    ])
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ lastQueuedAt: claimedAt }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await runScheduleTick('test-request-id')

    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
    expect(mockMarkJobFailed).toHaveBeenCalledWith(
      'pending-job-id',
      'Invalid pending schedule execution payload: Billing attribution snapshot is missing its billing entity'
    )
  })

  it('cancels stale pending database fallback jobs whose schedule claim was already released', async () => {
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
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'stale-pending-job-id' }])

    await runScheduleTick('test-request-id')
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'cancelled',
        error: expect.stringContaining('claim was released'),
        metadata: expect.anything(),
      })
    )
    expect(mockCancelJob).not.toHaveBeenCalled()
    expect(mockCompleteJob).not.toHaveBeenCalled()
  })

  it('reconciles pending database jobs with attempts instead of executing them', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    mockProcessingCounts(0, 0)
    orderByLimitMock.mockResolvedValueOnce([
      {
        id: 'claimed-pending-job-id',
        status: 'pending',
        payload: {
          scheduleId: 'schedule-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          now: claimedAt.toISOString(),
        },
      },
    ])
    queueTableRows(mockWorkflowExecutionLogs, [
      { executionId: 'execution-1', workflowId: 'workflow-1', status: 'completed' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'claimed-pending-job-id' }])

    await runScheduleTick('test-request-id')

    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
      })
    )
    expect(mockApplyScheduleSuccessUpdate).toHaveBeenCalledOnce()
  })

  it('preserves the occurrence when carrier lookup is uncertain', async () => {
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
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
    expect(mockReleaseScheduleLock).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({
        infraRetryCount: 1,
      })
    )
    expect(mockApplyScheduleFailureUpdate).not.toHaveBeenCalled()
  })

  it('preserves the occurrence when enqueue acceptance is unknown', async () => {
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const schedule = { ...SINGLE_SCHEDULE[0], lastQueuedAt: claimedAt }
    mockEnqueue.mockRejectedValueOnce(
      new AsyncJobEnqueueError('response lost after enqueue', {
        acceptance: 'unknown',
        retryable: true,
      })
    )
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')

    expect(mockEnqueue).toHaveBeenCalledOnce()
    expect(mockApplyScheduleFailureUpdate).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ infraRetryCount: 1 })
    )
  })

  it('marks schedules failed when non-retryable setup errors happen before enqueue', async () => {
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: claimedAt,
    }
    mockResolveSystemBillingAttribution.mockRejectedValueOnce(new Error('bad setup invariant'))
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockApplyScheduleFailureUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: schedule.id,
        expectedLastQueuedAt: claimedAt,
        nextRunAt: expect.any(Date),
      })
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({
        infraRetryCount: 1,
      })
    )
  })

  it('emails the schedule owners when a non-retryable setup failure disables the schedule', async () => {
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: claimedAt,
    }
    mockResolveSystemBillingAttribution.mockRejectedValueOnce(new Error('bad setup invariant'))
    mockApplyScheduleFailureUpdate.mockResolvedValueOnce({ updated: true, disabled: true })
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')

    expect(mockNotifyScheduleAutoDisabled).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: schedule.id, reason: 'consecutive_failures' })
    )
  })

  it('does not email when the failure update leaves the schedule active', async () => {
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: claimedAt,
    }
    mockResolveSystemBillingAttribution.mockRejectedValueOnce(new Error('bad setup invariant'))
    mockApplyScheduleFailureUpdate.mockResolvedValueOnce({ updated: true, disabled: false })
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')

    expect(mockNotifyScheduleAutoDisabled).not.toHaveBeenCalled()
  })

  it('uses one backend mode decision for slot accounting and schedule processing', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning
      .mockReturnValueOnce(SINGLE_SCHEDULE)
      .mockResolvedValueOnce([{ id: 'job-id-1' }])

    await runScheduleTick('test-request-id')
    expect(mockShouldExecuteInline).toHaveBeenCalledTimes(1)
    expect(mockExecuteScheduleJob).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: 'schedule-1' }),
      expect.any(AbortSignal)
    )
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
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
    expect(mockReleaseScheduleLock).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: originalClaim,
      })
    )
  })

  it('does not count Trigger.dev queue wait against the workflow execution timeout', async () => {
    const originalClaim = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const staleReclaim = new Date()
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: staleReclaim,
    }
    mockGetJob.mockResolvedValueOnce({
      id: 'job-id-1',
      status: 'pending',
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        now: originalClaim.toISOString(),
        executionTimeoutMs: 5 * 60 * 1000,
      },
    })
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')

    expect(mockCancelJob).not.toHaveBeenCalled()
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
    const startedAt = new Date(Date.now() - 11 * 60 * 1000)
    const staleReclaim = new Date()
    const originalClaim = staleReclaim
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: staleReclaim,
    }
    mockEnqueue.mockResolvedValueOnce('trigger-run-id')
    mockGetJob.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'trigger-run-id',
      status: 'processing',
      startedAt,
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        now: originalClaim.toISOString(),
        executionTimeoutMs: 5 * 60 * 1000,
      },
    })
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([{ workflowId: 'workflow-1', status: 'completed' }])
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])

    await runScheduleTick('test-request-id')
    expect(mockCancelJob).toHaveBeenCalledWith('trigger-run-id')
    expect(mockApplyScheduleSuccessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'schedule-1',
        expectedLastQueuedAt: originalClaim,
      })
    )
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
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
    // The workflow claim is capped by SCHEDULE_WORKFLOW_ENQUEUE_LIMIT
    // (SCHEDULE_EXECUTION_CONCURRENCY_LIMIT 30 x SCHEDULE_ENQUEUE_BUDGET_MULTIPLIER 2),
    // not by WORKFLOW_CHUNK_SIZE. This used to read 100, which only ever matched
    // the separate job claim's chunk size rather than the budget under test.
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(60)
    expect(mockEnqueue).toHaveBeenCalledTimes(100)
  })

  it('reconciles a terminal provider job with the claimed occurrence', async () => {
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: claimedAt,
    }
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([{ workflowId: 'workflow-1', status: 'completed' }])
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])
    mockGetJob.mockResolvedValueOnce({
      id: 'job-id-1',
      status: 'completed',
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        now: claimedAt.toISOString(),
      },
    })

    await runScheduleTick('test-request-id')
    expect(mockApplyScheduleSuccessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'schedule-1',
        expectedLastQueuedAt: claimedAt,
      })
    )
    expect(mockExecuteScheduleJob).not.toHaveBeenCalled()
  })

  it('uses a terminal cancelled carrier when no execution log exists', async () => {
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: claimedAt,
    }
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])
    mockGetJob.mockResolvedValueOnce({
      id: 'job-id-1',
      status: 'cancelled',
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        now: claimedAt.toISOString(),
      },
    })

    await runScheduleTick('test-request-id')

    expect(mockApplyScheduleCancellationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'schedule-1',
        expectedLastQueuedAt: claimedAt,
      })
    )
    expect(mockApplyScheduleFailureUpdate).not.toHaveBeenCalled()
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
  })

  it('does not change cadence when reconciliation fails after observing a carrier', async () => {
    const claimedAt = new Date('2025-01-01T00:00:00.000Z')
    const schedule = {
      ...SINGLE_SCHEDULE[0],
      lastQueuedAt: claimedAt,
    }
    dbChainMockFns.limit
      .mockResolvedValueOnce(SINGLE_CLAIMED_SCHEDULE_ROWS)
      .mockResolvedValueOnce([{ workflowId: 'workflow-1', status: 'completed' }])
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockReturnValueOnce([schedule]).mockReturnValueOnce([])
    mockGetJob.mockResolvedValueOnce({
      id: 'job-id-1',
      status: 'completed',
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        now: claimedAt.toISOString(),
      },
    })
    mockApplyScheduleSuccessUpdate.mockRejectedValueOnce(new Error('database unavailable'))

    await runScheduleTick('test-request-id')

    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
    expect(mockApplyScheduleFailureUpdate).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ infraRetryCount: 1 })
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
