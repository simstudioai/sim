/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockPreprocessExecution,
  mockTask,
  mockDbUpdate,
  mockDbSelect,
  mockExecuteWorkflowCore,
  mockLoggingSession,
  mockBlockExistsInDeployment,
  mockLoadDeployedWorkflowState,
  mockGetScheduleTimeValues,
  mockGetSubBlockValue,
} = vi.hoisted(() => ({
  mockPreprocessExecution: vi.fn(),
  mockTask: vi.fn((config) => config),
  mockDbUpdate: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  })),
  mockDbSelect: vi.fn(),
  mockExecuteWorkflowCore: vi.fn(),
  mockLoggingSession: vi.fn(),
  mockBlockExistsInDeployment: vi.fn(),
  mockLoadDeployedWorkflowState: vi.fn(),
  mockGetScheduleTimeValues: vi.fn(),
  mockGetSubBlockValue: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask }))

vi.mock('@sim/db', () => ({
  db: {
    update: mockDbUpdate,
    select: mockDbSelect,
  },
  workflow: {},
  workflowSchedule: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}))

vi.mock('@/lib/execution/preprocessing', () => ({
  preprocessExecution: mockPreprocessExecution,
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn().mockImplementation(() => {
    const instance = {
      safeStart: vi.fn().mockResolvedValue(true),
      safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
      markAsFailed: vi.fn().mockResolvedValue(undefined),
      waitForPostExecution: vi.fn().mockResolvedValue(undefined),
    }
    mockLoggingSession(instance)
    return instance
  }),
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

vi.mock('@/lib/workflows/persistence/utils', () => ({
  blockExistsInDeployment: mockBlockExistsInDeployment,
  loadDeployedWorkflowState: mockLoadDeployedWorkflowState,
}))

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

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { executeScheduleJob } from './schedule-execution'
import { executeWorkflowJob } from './workflow-execution'

describe('async preprocessing correlation threading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              id: 'schedule-1',
              workflowId: 'workflow-1',
              status: 'active',
              archivedAt: null,
            },
          ]),
        }),
      }),
    })
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
      userId: 'user-1',
      triggerType: 'api',
      executionId: 'execution-1',
      requestId: 'request-1',
    })

    const loggingSession = mockLoggingSession.mock.calls[0]?.[0]
    expect(loggingSession).toBeDefined()
    expect(loggingSession.safeStart).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        loggingSession,
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
      executionId: 'execution-2',
      requestId: 'request-2',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
    })

    const loggingSession = mockLoggingSession.mock.calls[0]?.[0]
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
      error: { message: 'preprocessing failed', statusCode: 500, logCreated: true },
    })

    await expect(
      executeWorkflowJob({
        workflowId: 'workflow-1',
        userId: 'user-1',
        triggerType: 'api',
        executionId: 'execution-1',
        requestId: 'request-1',
      })
    ).rejects.toThrow('preprocessing failed')

    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
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

  it('passes schedule correlation into preprocessing', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message: 'auth failed', statusCode: 401, logCreated: true },
    })

    await executeScheduleJob({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      executionId: 'execution-2',
      requestId: 'request-2',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
    })

    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
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
})
