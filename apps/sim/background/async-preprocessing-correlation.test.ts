/**
 * @vitest-environment node
 */

import {
  dbChainMock,
  dbChainMockFns,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  LoggingSessionMock,
  loggingSessionMock,
  resetDbChainMock,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMISSION_ERROR_CODE } from '@/lib/core/admission/transient-failure'

const {
  mockTask,
  mockExecuteWorkflowCore,
  mockGetBoundedSnapshotForWorkflow,
  mockGetScheduleTimeValues,
  mockGetSubBlockValue,
} = vi.hoisted(() => ({
  mockTask: vi.fn((config) => config),
  mockExecuteWorkflowCore: vi.fn(),
  mockGetBoundedSnapshotForWorkflow: vi.fn(),
  mockGetScheduleTimeValues: vi.fn(),
  mockGetSubBlockValue: vi.fn(),
}))

const mockPreprocessExecution = executionPreprocessingMockFns.mockPreprocessExecution
const mockLoadDeployedWorkflowState = workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask }))

vi.mock('@sim/db', () => ({
  ...dbChainMock,
  workflow: {},
  workflowSchedule: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}))

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)

vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: { getBoundedSnapshotForWorkflow: mockGetBoundedSnapshotForWorkflow },
}))

vi.mock('@/lib/core/execution-limits', () => ({
  createTimeoutAbortController: vi.fn(() => ({
    signal: undefined,
    cleanup: vi.fn(),
    isTimedOut: vi.fn().mockReturnValue(false),
    timeoutMs: undefined,
  })),
  getTimeoutErrorMessage: vi.fn(),
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn(() => ({ traceSpans: [] })),
}))

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: mockExecuteWorkflowCore,
  wasExecutionFinalizedByCore: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: {
    persistPauseResult: vi.fn(),
    processQueuedResumes: vi.fn(),
  },
}))

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/workflows/schedules/utils', () => ({
  calculateNextRunTime: vi.fn(),
  getScheduleTimeValues: mockGetScheduleTimeValues,
  getSubBlockValue: mockGetSubBlockValue,
}))

vi.mock('@/executor/execution/snapshot', () => ({
  ExecutionSnapshot: vi.fn(),
}))

vi.mock('@/executor/utils/errors', () => ({
  hasExecutionResult: vi.fn().mockReturnValue(false),
}))

import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import { executeScheduleJob } from './schedule-execution'
import { executeWorkflowJob, WorkflowExecutionAdmissionError } from './workflow-execution'

const billingAttribution = {
  actorUserId: 'actor-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'actor-1',
  billingEntity: { type: 'user' as const, id: 'actor-1' },
  billingPeriod: {
    start: '2025-01-01T00:00:00.000Z',
    end: '2025-02-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

const pinnedWorkflowState = {
  blocks: {
    'pinned-start': {
      id: 'pinned-start',
      type: 'starter',
      name: 'Pinned Start',
      position: { x: 0, y: 0 },
      subBlocks: {},
      outputs: {},
      enabled: true,
    },
  },
  edges: [],
  loops: {},
  parallels: {},
  variables: {
    'variable-1': {
      id: 'variable-1',
      name: 'message',
      type: 'string' as const,
      value: 'pinned',
    },
  },
}

describe('async preprocessing correlation threading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBoundedSnapshotForWorkflow.mockReset()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([
      {
        id: 'schedule-1',
        workflowId: 'workflow-1',
        status: 'active',
        archivedAt: null,
        lastQueuedAt: new Date('2025-01-01T00:00:00.000Z'),
        deploymentOperationId: null,
      },
    ])
    mockLoadDeployedWorkflowState.mockResolvedValue({
      blocks: {
        'schedule-block': {
          type: 'schedule',
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      deploymentVersionId: 'deployment-1',
    })
    mockGetSubBlockValue.mockReturnValue('daily')
    mockGetScheduleTimeValues.mockReturnValue({ timezone: 'UTC' })
  })

  it('does not pre-start workflow logging before core execution', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
      billingAttribution,
      executionTimeout: {},
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'success',
      output: { ok: true },
      metadata: { duration: 10, userId: 'actor-1' },
    })

    const result = await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'actor-1',
      workspaceId: 'workspace-1',
      billingAttribution,
      triggerType: 'api',
      executionId: 'execution-1',
      requestId: 'request-1',
    })

    expect(result.durationMs).toBe(10)

    const loggingSession = LoggingSessionMock.mock.results[0]?.value
    expect(loggingSession).toBeDefined()
    expect(loggingSession.safeStart).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        loggingSession,
      })
    )
  })

  it('fails fast when core execution omits duration metadata', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
      billingAttribution,
      executionTimeout: {},
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'success',
      output: { ok: true },
      metadata: { userId: 'actor-1' },
    })

    await expect(
      executeWorkflowJob({
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        billingAttribution,
        triggerType: 'api',
        executionId: 'execution-without-duration',
        requestId: 'request-without-duration',
      })
    ).rejects.toThrow('Workflow execution completed without valid duration metadata')

    const loggingSession = LoggingSessionMock.mock.results[0]?.value
    expect(loggingSession.safeCompleteWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Workflow execution completed without valid duration metadata',
        }),
      })
    )
  })

  it('does not pre-start schedule logging before core execution', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-2',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
      billingAttribution: { ...billingAttribution, actorUserId: 'actor-2' },
      executionTimeout: {},
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'success',
      output: { ok: true },
      metadata: { duration: 12, userId: 'actor-2' },
    })

    await executeScheduleJob({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      billingAttribution: { ...billingAttribution, actorUserId: 'actor-2' },
      executionId: 'execution-2',
      requestId: 'request-2',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
    })

    const loggingSession = LoggingSessionMock.mock.results[0]?.value
    expect(loggingSession).toBeDefined()
    expect(loggingSession.safeStart).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        loggingSession,
      })
    )
  })

  it('passes workflow correlation into preprocessing', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message: 'preprocessing failed', statusCode: 500 },
    })

    const execution = executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'actor-1',
      workspaceId: 'workspace-1',
      triggerType: 'api',
      executionId: 'execution-1',
      requestId: 'request-1',
      billingAttribution,
    })

    await expect(execution).rejects.toMatchObject({
      name: 'WorkflowExecutionAdmissionError',
      code: 'preprocessing_failed',
      message: 'preprocessing failed',
    })

    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        billingAttribution,
        triggerData: {
          correlation: {
            executionId: 'execution-1',
            requestId: 'request-1',
            source: 'workflow',
            workflowId: 'workflow-1',
            triggerType: 'api',
          },
        },
      })
    )
  })

  it('classifies pinned snapshot validation failures as admission errors', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
      billingAttribution,
      executionTimeout: {},
    })
    mockGetBoundedSnapshotForWorkflow.mockRejectedValueOnce(new Error('snapshot hash mismatch'))

    const execution = executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'actor-1',
      workspaceId: 'workspace-1',
      triggerType: 'workflow',
      executionId: 'snapshot-execution',
      requestId: 'snapshot-request',
      billingAttribution,
      workflowStateSnapshotId: 'snapshot-1',
    })

    await expect(execution).rejects.toBeInstanceOf(WorkflowExecutionAdmissionError)
    await expect(execution).rejects.toMatchObject({
      code: 'snapshot_load_failed',
      message: 'Failed to load pinned workflow snapshot: snapshot hash mismatch',
    })
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
  })

  it('does not classify core workflow failures as admission errors', async () => {
    const coreError = new Error('subject block failed')
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
      billingAttribution,
      executionTimeout: {},
    })
    mockExecuteWorkflowCore.mockRejectedValueOnce(coreError)

    const execution = executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'actor-1',
      workspaceId: 'workspace-1',
      triggerType: 'workflow',
      executionId: 'core-failure-execution',
      requestId: 'core-failure-request',
      billingAttribution,
    })

    await expect(execution).rejects.toBe(coreError)
    expect(coreError).not.toBeInstanceOf(WorkflowExecutionAdmissionError)
  })

  it('does not repeat admission gates for route-admitted workflow jobs', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message: 'preprocessing failed', statusCode: 500 },
    })

    await expect(
      executeWorkflowJob({
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        triggerType: 'api',
        executionId: 'execution-admitted',
        requestId: 'request-admitted',
        billingAttribution,
        admissionCompleted: true,
      })
    ).rejects.toThrow('preprocessing failed')

    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        checkRateLimit: false,
        skipUsageLimits: true,
      })
    )
  })

  it('skips the deployment gate and preserves draft execution metadata when requested', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
      billingAttribution,
      executionTimeout: {},
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'success',
      output: { ok: true },
      metadata: { duration: 10, userId: 'actor-1' },
    })

    await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'actor-1',
      workspaceId: 'workspace-1',
      triggerType: 'workflow',
      executionId: 'draft-execution',
      requestId: 'draft-request',
      billingAttribution,
      useDraftState: true,
    })

    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ checkDeployment: false })
    )
    expect(vi.mocked(ExecutionSnapshot)).toHaveBeenCalledWith(
      expect.objectContaining({ useDraftState: true }),
      expect.anything(),
      undefined,
      {},
      []
    )
  })

  it('loads a bounded pinned snapshot as the draft override and uses its variables', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {
          'live-variable': {
            id: 'live-variable',
            name: 'message',
            type: 'string',
            value: 'live',
          },
        },
      },
      billingAttribution,
      executionTimeout: {},
    })
    mockGetBoundedSnapshotForWorkflow.mockResolvedValueOnce({
      id: 'snapshot-1',
      workflowId: 'workflow-1',
      stateHash: '0'.repeat(64),
      stateData: pinnedWorkflowState,
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'success',
      output: { ok: true },
      metadata: { duration: 10, userId: 'actor-1' },
    })

    await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'actor-1',
      workspaceId: 'workspace-1',
      triggerType: 'workflow',
      executionId: 'pinned-execution',
      requestId: 'pinned-request',
      billingAttribution,
      workflowStateSnapshotId: 'snapshot-1',
      triggerBlockId: 'pinned-start',
    })

    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ checkDeployment: false })
    )
    expect(mockGetBoundedSnapshotForWorkflow).toHaveBeenCalledWith('snapshot-1', 'workflow-1')
    expect(vi.mocked(ExecutionSnapshot)).toHaveBeenCalledWith(
      expect.objectContaining({
        useDraftState: true,
        triggerBlockId: 'pinned-start',
        workflowStateOverride: {
          blocks: pinnedWorkflowState.blocks,
          edges: pinnedWorkflowState.edges,
          loops: pinnedWorkflowState.loops,
          parallels: pinnedWorkflowState.parallels,
        },
      }),
      expect.anything(),
      undefined,
      pinnedWorkflowState.variables,
      []
    )
  })

  it('rejects contradictory pinned and deployed-state controls before preprocessing', async () => {
    await expect(
      executeWorkflowJob({
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        triggerType: 'workflow',
        executionId: 'invalid-pinned-execution',
        requestId: 'invalid-pinned-request',
        billingAttribution,
        workflowStateSnapshotId: 'snapshot-1',
        useDraftState: false,
      })
    ).rejects.toThrow('Pinned workflow state cannot be combined with useDraftState=false')

    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockGetBoundedSnapshotForWorkflow).not.toHaveBeenCalled()
  })

  it('rejects an empty explicit trigger block before preprocessing', async () => {
    await expect(
      executeWorkflowJob({
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        triggerType: 'workflow',
        executionId: 'invalid-trigger-execution',
        requestId: 'invalid-trigger-request',
        billingAttribution,
        triggerBlockId: ' ',
      })
    ).rejects.toThrow('Trigger block ID must be a non-empty string')

    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('passes schedule correlation into preprocessing', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message: 'auth failed', statusCode: 401 },
    })

    await executeScheduleJob({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      executionId: 'execution-2',
      requestId: 'request-2',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
      billingAttribution,
    })

    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        billingAttribution,
        triggerData: {
          correlation: {
            executionId: 'execution-2',
            requestId: 'request-2',
            source: 'schedule',
            workflowId: 'workflow-1',
            scheduleId: 'schedule-1',
            triggerType: 'schedule',
            scheduledFor: '2025-01-01T00:00:00.000Z',
          },
        },
      })
    )
  })

  it('increments infrastructure retry count for retryable schedule preprocessing failures', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'database unavailable',
        statusCode: 500,
        retryable: true,
        cause: { code: '53300' },
      },
    })

    await executeScheduleJob({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      billingAttribution,
      executionId: 'execution-retry',
      requestId: 'request-retry',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
      infraRetryCount: 2,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: null,
        infraRetryCount: 3,
      })
    )
  })

  it('routes retryable reservation concurrency through bounded infrastructure backoff', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Too many concurrent executions',
        statusCode: 429,
        retryable: true,
        code: ADMISSION_ERROR_CODE.RESERVATION_CONCURRENCY,
      },
    })

    await executeScheduleJob({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      billingAttribution,
      executionId: 'execution-concurrency-retry',
      requestId: 'request-concurrency-retry',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
      infraRetryCount: 2,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: null,
        infraRetryCount: 3,
      })
    )
  })

  it('keeps retryable non-admission 429 failures on the fixed rate-limit delay', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Rate limit exceeded',
        statusCode: 429,
        retryable: true,
        code: 'RATE_LIMIT_EXCEEDED',
      },
    })

    await executeScheduleJob({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      billingAttribution,
      executionId: 'execution-rate-limit',
      requestId: 'request-rate-limit',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
      infraRetryCount: 2,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: null,
        infraRetryCount: 0,
      })
    )
    const update = dbChainMockFns.set.mock.calls.at(-1)?.[0]
    expect(update.nextRunAt.getTime() - update.updatedAt.getTime()).toBe(5 * 60 * 1000)
  })

  it('moves exhausted infrastructure retries onto the normal failure path', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'database unavailable',
        statusCode: 500,
        retryable: true,
        cause: { code: '53300' },
      },
    })

    await executeScheduleJob({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      billingAttribution,
      executionId: 'execution-retry-exhausted',
      requestId: 'request-retry-exhausted',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
      infraRetryCount: 10,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: null,
        lastFailedAt: expect.any(Date),
        infraRetryCount: 0,
      })
    )
  })
})
