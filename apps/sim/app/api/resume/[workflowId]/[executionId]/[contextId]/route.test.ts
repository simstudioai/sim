/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnqueueOrStartResume,
  mockGetCurrentPayer,
  mockGetPauseContextDetail,
  mockGetPausedExecutionDetail,
  mockPreprocessExecution,
  mockValidateWorkflowAccess,
} = vi.hoisted(() => ({
  mockEnqueueOrStartResume: vi.fn(),
  mockGetCurrentPayer: vi.fn(),
  mockGetPauseContextDetail: vi.fn(),
  mockGetPausedExecutionDetail: vi.fn(),
  mockPreprocessExecution: vi.fn(),
  mockValidateWorkflowAccess: vi.fn(),
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
    startResumeExecution: vi.fn(),
  },
}))

import { GET, POST } from '@/app/api/resume/[workflowId]/[executionId]/[contextId]/route'

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
          executionMode: 'sync',
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
    expect(mockEnqueueOrStartResume).toHaveBeenCalledWith({
      executionId: EXECUTION_ID,
      workflowId: WORKFLOW_ID,
      contextId: CONTEXT_ID,
      resumeInput: { approved: true },
      userId: 'current-api-key-user',
      allowedPauseKinds: ['human'],
    })
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
