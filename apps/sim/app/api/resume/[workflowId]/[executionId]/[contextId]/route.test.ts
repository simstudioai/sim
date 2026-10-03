import { createRouteContext } from '@sim/testing/helpers/http'
import { asyncJobsMock, asyncJobsMockFns } from '@sim/testing/mocks/async-jobs.mock'
import {
  executionPreprocessingMock,
  executionPreprocessingMockFns,
} from '@sim/testing/mocks/execution-preprocessing.mock'
import {
  humanInTheLoopManagerMock,
  humanInTheLoopManagerMockFns,
} from '@sim/testing/mocks/human-in-the-loop-manager.mock'
import { idMock, idMockFns } from '@sim/testing/mocks/id.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  workspacesUtilsMock,
  workspacesUtilsMockFns,
} from '@sim/testing/mocks/workspaces-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockValidateWorkflowAccess } = vi.hoisted(() => ({
  mockValidateWorkflowAccess: vi.fn(),
}))

vi.mock('@/app/api/workflows/middleware', () => ({
  validateWorkflowAccess: mockValidateWorkflowAccess,
}))

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)

vi.mock('@/lib/core/async-jobs', () => asyncJobsMock)

vi.mock('@/lib/workflows/executor/enqueue-execution', () => ({
  RESUME_EXECUTION_JOB_ID_PREFIX: 'resume-execution:',
}))

vi.mock('@sim/utils/id', () => idMock)

vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => humanInTheLoopManagerMock)

import { POST } from '@/app/api/resume/[workflowId]/[executionId]/[contextId]/route'
import { handleResumeExecution } from '@/app/api/resume/resume-handler'

const { mockEnqueueOrStartResume, mockGetPausedExecutionDetail } = humanInTheLoopManagerMockFns
const { mockGetWorkspaceBilledAccountUserId: mockGetCurrentPayer } = workspacesUtilsMockFns

const { mockShouldExecuteInline } = asyncJobsMockFns
mockShouldExecuteInline.mockReturnValue(false)
const mockEnqueueResume = asyncJobsMockFns.mockJobQueue.enqueue
mockEnqueueResume.mockResolvedValue('resume-execution:resume-execution-1')

const mockPreprocessExecution = executionPreprocessingMockFns.mockPreprocessExecution
idMockFns.mockGenerateId.mockReturnValue('resume-preflight-1')

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
  executionMode?: 'sync' | 'stream' | 'async'
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
        version: 1,
        metadata: {
          requestId: 'request-original',
          workflowId: overrides.snapshotWorkflowId ?? WORKFLOW_ID,
          executionId: overrides.snapshotExecutionId ?? EXECUTION_ID,
          workspaceId: overrides.snapshotWorkspaceId ?? WORKSPACE_ID,
          userId: overrides.snapshotActorUserId ?? PERSISTED_ACTOR_ID,
          principal: {
            version: 1,
            principal: {
              kind: 'session',
              userId: overrides.snapshotActorUserId ?? PERSISTED_ACTOR_ID,
              sessionId: 'session-original',
            },
          },
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
    request: createMockRequest({
      method: 'POST',
      url: `http://localhost/api/resume/${params.workflowId}/${params.executionId}/${params.contextId}`,
      headers: { 'Content-Type': 'application/json' },
      rawBody: body,
    }),
    context: createRouteContext(params),
  }
}

describe('POST /api/resume/[workflowId]/[executionId]/[contextId]', () => {
  beforeEach(() => {
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

  it('preserves the legacy async job polling response', async () => {
    mockGetPausedExecutionDetail.mockResolvedValueOnce(
      createPausedExecution({ executionMode: 'async' })
    )
    mockEnqueueOrStartResume.mockResolvedValueOnce({
      status: 'started',
      resumeExecutionId: 'resume-execution-1',
      resumeEntryId: 'resume-entry-1',
      pausedExecution: { id: 'paused-execution-1' },
      contextId: CONTEXT_ID,
      resumeInput: { approved: true },
      userId: 'current-api-key-user',
    })
    const { request, context } = makeRequest()

    const response = await POST(request, context)

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      success: true,
      async: true,
      jobId: 'resume-execution:resume-execution-1',
      executionId: 'resume-execution-1',
      message: 'Resume execution queued',
      statusUrl: 'https://test.sim.ai/api/jobs/resume-execution:resume-execution-1',
    })
    expect(mockEnqueueResume).toHaveBeenCalledWith(
      'resume-execution',
      expect.objectContaining({ resumeExecutionId: 'resume-execution-1' }),
      expect.objectContaining({
        metadata: expect.objectContaining({ workflowId: WORKFLOW_ID }),
      })
    )
    expect(mockEnqueueResume.mock.calls[0]?.[2]).not.toHaveProperty('jobId')
  })

  it('uses deterministic dispatch and execution polling for the v2 surface', async () => {
    mockGetPausedExecutionDetail.mockResolvedValueOnce(
      createPausedExecution({ executionMode: 'async' })
    )
    mockEnqueueOrStartResume.mockResolvedValueOnce({
      status: 'started',
      resumeExecutionId: 'resume-execution-1',
      resumeEntryId: 'resume-entry-1',
      pausedExecution: { id: 'paused-execution-1' },
      contextId: CONTEXT_ID,
      resumeInput: { approved: true },
      userId: 'current-api-key-user',
    })
    const { request } = makeRequest()

    const response = await handleResumeExecution({
      request,
      workflowId: WORKFLOW_ID,
      executionId: EXECUTION_ID,
      contextId: CONTEXT_ID,
      workspaceId: WORKSPACE_ID,
      userId: 'current-api-key-user',
      resumeInput: { approved: true },
      isApiCaller: true,
      pollingSurface: 'v2',
    })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      success: true,
      async: true,
      executionId: 'resume-execution-1',
      message: 'Resume execution queued',
      statusUrl: 'https://test.sim.ai/api/v2/workflows/workflow-1/runs/resume-execution-1',
    })
    expect(mockEnqueueResume).toHaveBeenCalledWith(
      'resume-execution',
      expect.objectContaining({ resumeExecutionId: 'resume-execution-1' }),
      expect.objectContaining({
        jobId: 'resume-execution:resume-entry-1',
        metadata: expect.objectContaining({ workflowId: WORKFLOW_ID }),
      })
    )
  })

  it('queues inherited stream-mode resumes when the caller requires JSON', async () => {
    mockGetPausedExecutionDetail.mockResolvedValueOnce(
      createPausedExecution({ executionMode: 'stream' })
    )
    mockEnqueueOrStartResume.mockResolvedValueOnce({
      status: 'started',
      resumeExecutionId: 'resume-execution-1',
      resumeEntryId: 'resume-entry-1',
      pausedExecution: { id: 'paused-execution-1' },
      contextId: CONTEXT_ID,
      resumeInput: { approved: true },
      userId: 'current-api-key-user',
    })
    const { request } = makeRequest()

    const response = await handleResumeExecution({
      request,
      workflowId: WORKFLOW_ID,
      executionId: EXECUTION_ID,
      contextId: CONTEXT_ID,
      workspaceId: WORKSPACE_ID,
      userId: 'current-api-key-user',
      resumeInput: { approved: true },
      isApiCaller: true,
      pollingSurface: 'v2',
      allowStreaming: false,
    })

    expect(response.status).toBe(202)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    await expect(response.json()).resolves.toMatchObject({
      async: true,
      executionId: 'resume-execution-1',
      statusUrl: 'https://test.sim.ai/api/v2/workflows/workflow-1/runs/resume-execution-1',
    })
    expect(mockEnqueueResume).toHaveBeenCalledWith(
      'resume-execution',
      expect.objectContaining({ resumeExecutionId: 'resume-execution-1' }),
      expect.objectContaining({ jobId: 'resume-execution:resume-entry-1' })
    )
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
