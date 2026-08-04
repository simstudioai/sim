/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnqueue,
  mockEnqueueOrStartResume,
  mockGetCurrentPayer,
  mockGetPauseContextDetail,
  mockGetPausedExecutionDetail,
  mockPreprocessExecution,
  mockStartResumeExecution,
  mockExecuteResumeJob,
  mockShouldExecuteInline,
  mockValidateWorkflowAccess,
} = vi.hoisted(() => ({
  mockEnqueue: vi.fn(),
  mockEnqueueOrStartResume: vi.fn(),
  mockGetCurrentPayer: vi.fn(),
  mockGetPauseContextDetail: vi.fn(),
  mockGetPausedExecutionDetail: vi.fn(),
  mockPreprocessExecution: vi.fn(),
  mockStartResumeExecution: vi.fn(),
  mockExecuteResumeJob: vi.fn(),
  mockShouldExecuteInline: vi.fn(() => false),
  mockValidateWorkflowAccess: vi.fn(),
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn(async () => ({ enqueue: mockEnqueue })),
  shouldExecuteInline: mockShouldExecuteInline,
}))

vi.mock('@/background/resume-execution', () => ({
  executeResumeJob: mockExecuteResumeJob,
}))

vi.mock('@/app/api/workflows/middleware', () => ({
  validateWorkflowAccess: mockValidateWorkflowAccess,
}))

vi.mock('@/lib/execution/preprocessing', () => ({
  preprocessExecution: mockPreprocessExecution,
}))

vi.mock('@sim/utils/id', () => ({
  generateId: () => 'resume-preflight-1',
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: mockGetCurrentPayer,
}))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: {
    enqueueOrStartResume: mockEnqueueOrStartResume,
    getPauseContextDetail: mockGetPauseContextDetail,
    getPausedExecutionDetail: mockGetPausedExecutionDetail,
    markResumeAttemptFailed: vi.fn(),
    processQueuedResumes: vi.fn(),
    startResumeExecution: mockStartResumeExecution,
  },
}))

import { GET, POST } from '@/app/api/resume/[workflowId]/[executionId]/[contextId]/route'

const resumeApiLoggerCallIndex = loggerMock.createLogger.mock.calls.findIndex(
  ([name]) => name === 'WorkflowResumeAPI'
)
const resumeApiLogger = loggerMock.createLogger.mock.results[resumeApiLoggerCallIndex]?.value
if (!resumeApiLogger) {
  throw new Error('WorkflowResumeAPI logger mock was not initialized')
}

const WORKFLOW_ID = 'workflow-1'
const EXECUTION_ID = 'execution-1'
const CONTEXT_ID = 'context-1'
const WORKSPACE_ID = 'workspace-1'
const PERSISTED_ACTOR_ID = 'original-actor'

const PERSISTED_ATTRIBUTION = {
  actorUserId: PERSISTED_ACTOR_ID,
  workspaceId: WORKSPACE_ID,
  organizationId: 'organization-original',
  billedAccountUserId: 'owner-original',
  billingEntity: { type: 'organization' as const, id: 'organization-original' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: {
    id: 'subscription-original',
    referenceId: 'organization-original',
    plan: 'team_25000',
    status: 'active',
    seats: 5,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
  },
}

interface PausedExecutionOverrides {
  workflowId?: string
  executionId?: string
  snapshotWorkflowId?: string
  snapshotExecutionId?: string
  snapshotWorkspaceId?: string
  snapshotActorUserId?: string
  billingAttribution?: unknown
  executionMode?: 'sync' | 'async' | 'stream'
}

function createPausedExecution(overrides: PausedExecutionOverrides = {}) {
  const billingAttribution =
    'billingAttribution' in overrides
      ? overrides.billingAttribution
      : structuredClone(PERSISTED_ATTRIBUTION)

  return {
    id: 'paused-execution-1',
    workflowId: overrides.workflowId ?? WORKFLOW_ID,
    executionId: overrides.executionId ?? EXECUTION_ID,
    executionSnapshot: {
      snapshot: JSON.stringify({
        metadata: {
          requestId: 'request-original',
          workflowId: overrides.snapshotWorkflowId ?? WORKFLOW_ID,
          executionId: overrides.snapshotExecutionId ?? EXECUTION_ID,
          workspaceId: overrides.snapshotWorkspaceId ?? WORKSPACE_ID,
          userId: overrides.snapshotActorUserId ?? PERSISTED_ACTOR_ID,
          billingAttribution,
          triggerType: 'manual',
          useDraftState: false,
          startTime: '2026-07-10T00:00:00.000Z',
          executionMode: overrides.executionMode ?? 'sync',
        },
        workflow: { version: '1', blocks: [], connections: [] },
        input: {},
        workflowVariables: {},
        selectedOutputs: [],
      }),
      triggerIds: [],
    },
  }
}

function makeRequest(
  params: { workflowId: string; executionId: string; contextId: string } = {
    workflowId: WORKFLOW_ID,
    executionId: EXECUTION_ID,
    contextId: CONTEXT_ID,
  },
  body = JSON.stringify({ input: { approved: true } })
) {
  return {
    request: new NextRequest(
      `http://localhost/api/resume/${params.workflowId}/${params.executionId}/${params.contextId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }
    ),
    context: { params: Promise.resolve(params) },
  }
}

describe('POST /api/resume/[workflowId]/[executionId]/[contextId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateWorkflowAccess.mockResolvedValue({
      workflow: {
        id: WORKFLOW_ID,
        workspaceId: WORKSPACE_ID,
      },
      auth: {
        success: true,
        userId: 'current-api-key-user',
        authType: 'api_key',
        apiKeyType: 'workspace',
        workspaceId: WORKSPACE_ID,
      },
    })
    mockGetCurrentPayer.mockResolvedValue('current-workspace-owner')
    mockGetPausedExecutionDetail.mockResolvedValue(createPausedExecution())
    mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: PERSISTED_ACTOR_ID,
      billingAttribution: PERSISTED_ATTRIBUTION,
      executionTimeout: { sync: 30_000, async: 300_000 },
    })
    mockEnqueueOrStartResume.mockResolvedValue({
      status: 'queued',
      resumeExecutionId: EXECUTION_ID,
      queuePosition: 1,
    })
    mockEnqueue.mockResolvedValue('resume-job-1')
    mockExecuteResumeJob.mockResolvedValue({ success: true })
    mockStartResumeExecution.mockResolvedValue({
      success: true,
      status: 'completed',
      output: {},
      logs: [],
    })
    mockShouldExecuteInline.mockReturnValue(false)
  })

  it('returns 401 before validating malformed route input', async () => {
    mockValidateWorkflowAccess.mockResolvedValueOnce({
      error: { message: 'Unauthorized', status: 401 },
    })
    const { request, context } = makeRequest(
      {
        workflowId: WORKFLOW_ID,
        executionId: '',
        contextId: '',
      },
      '{'
    )

    const response = await POST(request, context)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockValidateWorkflowAccess).toHaveBeenCalledWith(request, WORKFLOW_ID, false)
    expect(mockGetPausedExecutionDetail).not.toHaveBeenCalled()
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('reuses the persisted actor and payer snapshot for route preflight', async () => {
    const { request, context } = makeRequest()

    const response = await POST(request, context)

    expect(mockValidateWorkflowAccess).toHaveBeenCalledWith(request, WORKFLOW_ID, false)
    expect(response.status).toBe(200)
    expect(mockGetCurrentPayer).not.toHaveBeenCalled()
    expect(mockGetPausedExecutionDetail).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      executionId: EXECUTION_ID,
    })
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: WORKFLOW_ID,
        userId: 'current-api-key-user',
        workspaceId: WORKSPACE_ID,
        billingAttribution: PERSISTED_ATTRIBUTION,
        executionId: 'resume-preflight-1',
        skipConcurrencyReservation: true,
        logPreprocessingErrors: false,
      })
    )
    expect(mockPreprocessExecution.mock.calls[0]?.[0]).not.toHaveProperty('skipUsageLimits')
    expect(mockPreprocessExecution.mock.calls[0]?.[0]).not.toHaveProperty('reservationId')
    expect(mockEnqueueOrStartResume).toHaveBeenCalledWith({
      executionId: EXECUTION_ID,
      workflowId: WORKFLOW_ID,
      contextId: CONTEXT_ID,
      resumeInput: { approved: true },
      userId: 'current-api-key-user',
      allowedPauseKinds: ['human'],
    })
  })

  it('correlates an async resume job to its parent workflow execution', async () => {
    const pausedExecution = createPausedExecution({ executionMode: 'async' })
    mockGetPausedExecutionDetail.mockResolvedValueOnce(pausedExecution)
    mockEnqueueOrStartResume.mockResolvedValueOnce({
      status: 'starting',
      resumeExecutionId: 'resume-attempt-1',
      resumeEntryId: 'resume-entry-1',
      pausedExecution,
      contextId: CONTEXT_ID,
      resumeInput: { approved: true },
      userId: 'current-api-key-user',
    })
    const { request, context } = makeRequest()

    const response = await POST(request, context)

    expect(response.status).toBe(202)
    expect(mockEnqueue).toHaveBeenCalledWith(
      'resume-execution',
      expect.objectContaining({
        parentExecutionId: EXECUTION_ID,
        resumeExecutionId: 'resume-attempt-1',
        workflowId: WORKFLOW_ID,
      }),
      expect.objectContaining({
        maxDurationSeconds: 600,
        metadata: {
          executionId: EXECUTION_ID,
          workflowId: WORKFLOW_ID,
          workspaceId: WORKSPACE_ID,
          userId: 'current-api-key-user',
          resumeExecutionId: 'resume-attempt-1',
          correlation: {
            executionId: EXECUTION_ID,
            requestId: expect.any(String),
            source: 'workflow',
            workflowId: WORKFLOW_ID,
            triggerType: 'resume',
          },
        },
      })
    )
  })

  it('forwards database inline timeout failures so the queue marks the resume job failed', async () => {
    const pausedExecution = createPausedExecution({ executionMode: 'async' })
    mockGetPausedExecutionDetail.mockResolvedValueOnce(pausedExecution)
    mockEnqueueOrStartResume.mockResolvedValueOnce({
      status: 'starting',
      resumeExecutionId: 'resume-attempt-1',
      resumeEntryId: 'resume-entry-1',
      pausedExecution,
      contextId: CONTEXT_ID,
      resumeInput: { approved: true },
      userId: 'current-api-key-user',
    })
    mockShouldExecuteInline.mockReturnValueOnce(true)
    const timeoutError = Object.assign(new Error('Execution timed out after 5 minutes'), {
      name: 'TimeoutError',
    })
    mockExecuteResumeJob.mockRejectedValueOnce(timeoutError)
    const { request, context } = makeRequest()

    const response = await POST(request, context)
    const options = mockEnqueue.mock.calls[0]?.[2] as {
      runner?: (payload: unknown, signal: AbortSignal) => Promise<unknown>
    }
    const signal = new AbortController().signal

    expect(response.status).toBe(202)
    expect(options.runner).toBeTypeOf('function')
    await expect(options.runner?.({}, signal)).rejects.toBe(timeoutError)
    expect(mockExecuteResumeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeEntryId: 'resume-entry-1',
        resumeExecutionId: 'resume-attempt-1',
      }),
      signal
    )
  })

  it('projects rejected resume requests for logs without changing the API error response', async () => {
    const secret = 'resume-request-secret-value'
    const message = `Resume request exposed ${secret} __var_API_KEY __sim_code_1_binding_0`
    const rawError = new Error(message)
    mockEnqueueOrStartResume.mockRejectedValueOnce(rawError)
    const { request, context } = makeRequest()

    const response = await POST(request, context)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: message })
    expect(resumeApiLogger.error).toHaveBeenCalledWith('Resume request failed', {
      errorType: 'error',
      hasStack: true,
    })
    const loggerPayload = JSON.stringify(resumeApiLogger.error.mock.calls)
    expect(loggerPayload).not.toContain(secret)
    expect(loggerPayload).not.toContain('__var_')
    expect(loggerPayload).not.toContain('__sim_')
    expect(rawError.message).toBe(message)
  })

  it('projects detached resume failures without changing the started response', async () => {
    const secret = 'detached-resume-secret-value'
    const message = `Detached resume exposed ${secret} __var_API_KEY __sim_code_2_binding_0`
    const rawError = new Error(message)
    const pausedExecution = createPausedExecution()
    mockValidateWorkflowAccess.mockResolvedValueOnce({
      workflow: {
        id: WORKFLOW_ID,
        workspaceId: WORKSPACE_ID,
      },
      auth: {
        success: true,
        userId: 'current-session-user',
        authType: 'session',
        workspaceId: WORKSPACE_ID,
      },
    })
    mockEnqueueOrStartResume.mockResolvedValueOnce({
      status: 'starting',
      resumeExecutionId: 'resume-attempt-1',
      resumeEntryId: 'resume-entry-1',
      pausedExecution,
      contextId: CONTEXT_ID,
      resumeInput: { approved: true },
      userId: 'current-session-user',
    })
    mockStartResumeExecution.mockRejectedValueOnce(rawError)
    const { request, context } = makeRequest()

    const response = await POST(request, context)
    await Promise.resolve()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'started',
      executionId: 'resume-attempt-1',
      message: 'Resume execution started.',
    })
    expect(resumeApiLogger.error).toHaveBeenCalledWith('Failed to start resume execution', {
      errorType: 'error',
      hasStack: true,
    })
    const loggerPayload = JSON.stringify(resumeApiLogger.error.mock.calls)
    expect(loggerPayload).not.toContain(secret)
    expect(loggerPayload).not.toContain('__var_')
    expect(loggerPayload).not.toContain('__sim_')
    expect(rawError.message).toBe(message)
  })

  it.each([
    { statusCode: 402, message: 'Member usage limit reached', retryable: false },
    { statusCode: 429, message: 'Target concurrency full', retryable: true },
    { statusCode: 503, message: 'Usage admission unavailable', retryable: true },
  ])(
    'leaves the pause and queued input untouched when readmission returns $statusCode',
    async ({ statusCode, message, retryable }) => {
      mockPreprocessExecution.mockResolvedValueOnce({
        success: false,
        error: { statusCode, message, retryable },
      })
      const { request, context } = makeRequest()

      const response = await POST(request, context)

      expect(response.status).toBe(statusCode)
      expect(await response.json()).toEqual({ error: message })
      expect(mockEnqueueOrStartResume).not.toHaveBeenCalled()
    }
  )

  it('fails closed when the persisted snapshot has no billing attribution', async () => {
    mockGetPausedExecutionDetail.mockResolvedValueOnce(
      createPausedExecution({ billingAttribution: undefined })
    )
    const { request, context } = makeRequest()

    const response = await POST(request, context)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Paused execution billing attribution is missing or invalid',
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockEnqueueOrStartResume).not.toHaveBeenCalled()
  })

  it('fails closed when the persisted billing attribution is malformed', async () => {
    mockGetPausedExecutionDetail.mockResolvedValueOnce(
      createPausedExecution({
        billingAttribution: {
          actorUserId: PERSISTED_ACTOR_ID,
          workspaceId: WORKSPACE_ID,
        },
      })
    )
    const { request, context } = makeRequest()

    const response = await POST(request, context)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Paused execution billing attribution is missing or invalid',
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockEnqueueOrStartResume).not.toHaveBeenCalled()
  })

  it.each([
    [
      'workspace',
      createPausedExecution({
        billingAttribution: {
          ...structuredClone(PERSISTED_ATTRIBUTION),
          workspaceId: 'workspace-other',
        },
      }),
    ],
    [
      'actor',
      createPausedExecution({
        billingAttribution: {
          ...structuredClone(PERSISTED_ATTRIBUTION),
          actorUserId: 'actor-other',
        },
      }),
    ],
  ])('rejects a persisted %s attribution mismatch', async (_field, pausedExecution) => {
    mockGetPausedExecutionDetail.mockResolvedValueOnce(pausedExecution)
    const { request, context } = makeRequest()

    const response = await POST(request, context)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Paused execution billing attribution does not match its workspace or actor',
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockEnqueueOrStartResume).not.toHaveBeenCalled()
  })

  it.each([
    ['workflow', createPausedExecution({ snapshotWorkflowId: 'workflow-other' })],
    ['execution', createPausedExecution({ snapshotExecutionId: 'execution-other' })],
  ])('rejects a persisted %s binding mismatch', async (_field, pausedExecution) => {
    mockGetPausedExecutionDetail.mockResolvedValueOnce(pausedExecution)
    const { request, context } = makeRequest()

    const response = await POST(request, context)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Paused execution snapshot does not match the requested workflow or execution',
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockEnqueueOrStartResume).not.toHaveBeenCalled()
  })
})

describe('GET /api/resume/[workflowId]/[executionId]/[contextId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 before validating malformed route input', async () => {
    mockValidateWorkflowAccess.mockResolvedValueOnce({
      error: { message: 'Unauthorized', status: 401 },
    })
    const request = new NextRequest(
      `http://localhost/api/resume/${WORKFLOW_ID}/${EXECUTION_ID}/${CONTEXT_ID}`
    )
    const context = {
      params: Promise.resolve({
        workflowId: WORKFLOW_ID,
        executionId: '',
        contextId: '',
      }),
    }

    const response = await GET(request, context)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockValidateWorkflowAccess).toHaveBeenCalledWith(request, WORKFLOW_ID, false)
    expect(mockGetPauseContextDetail).not.toHaveBeenCalled()
  })
})
