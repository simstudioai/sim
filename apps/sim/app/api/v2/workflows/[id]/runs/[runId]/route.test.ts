/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  capture: vi.fn(),
  readRun: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

vi.mock('@/lib/workflows/application/read-workflow-run', () => ({
  readWorkflowRun: {
    operation: { id: 'workflows.runs.read' },
    execute: mocks.readRun,
  },
}))

vi.mock('@/lib/workflows/application/cancel-run', () => ({
  cancelWorkflowRun: {
    operation: { id: 'workflows.runs.cancel' },
    execute: mocks.cancel,
  },
}))

import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'
import { POST as cancelPost } from '@/app/api/v2/workflows/[id]/runs/[runId]/cancel/route'
import { GET } from '@/app/api/v2/workflows/[id]/runs/[runId]/route'

const principal = {
  kind: 'workspace_api_key' as const,
  workspaceId: 'workspace-1',
  keyId: 'key-1',
}
const auth = {
  principal,
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', 'workspace:workspace-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

function callStatus(query = '') {
  const req = createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/v2/workflows/workflow-1/runs/run-1${query}`
  )
  return GET(req, { params: Promise.resolve({ id: 'workflow-1', runId: 'run-1' }) })
}

const baseStatus = {
  executionId: 'run-1',
  workflowId: 'workflow-1',
  status: 'failed' as const,
  trigger: 'api',
  level: 'error',
  startedAt: '2026-07-31T00:00:00.000Z',
  endedAt: '2026-07-31T00:00:05.000Z',
  totalDurationMs: 5000,
  paused: null,
  cost: { total: 0.02 },
  error: 'Send Email: Invalid credentials',
  finalOutput: null,
  blockOutputs: null,
}

/**
 * Local denial fixture — the harness only publishes the allowed shapes, and the
 * cancel adapter must surface `retryAfterMs` as a `Retry-After` header.
 */
const OPERATION_RATE_LIMIT_DENIED = {
  allowed: false,
  remaining: 0,
  resetAt: new Date('2026-08-05T01:00:00Z'),
  retryAfterMs: 5_000,
} as const

const successfulCancellation = {
  success: true,
  executionId: 'run-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  redisAvailable: true,
  durablyRecorded: true,
  locallyAborted: false,
  pausedCancelled: false,
  reason: 'recorded',
}

describe('v2 run detail and cancel adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.readRun.mockResolvedValue(baseStatus)
    mocks.cancel.mockResolvedValue(successfulCancellation)
  })

  it('returns the run resource with a structured error', async () => {
    const response = await callStatus()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({
      runId: 'run-1',
      workflowId: 'workflow-1',
      status: 'failed',
      durationMs: 5000,
      error: {
        code: 'EXECUTION_FAILED',
        message: 'Send Email: Invalid credentials',
      },
    })
    expect(mocks.readRun).toHaveBeenCalledWith({
      principal,
      input: {
        workflowId: 'workflow-1',
        runId: 'run-1',
        includeOutput: false,
        selectedOutputs: [],
      },
      request: expect.anything(),
    })
  })

  it('returns the queued run resource before a durable log exists', async () => {
    mocks.readRun.mockResolvedValueOnce({
      ...baseStatus,
      status: 'queued',
      level: 'info',
      endedAt: null,
      totalDurationMs: null,
      cost: null,
      error: null,
    })

    expect((await (await callStatus()).json()).data.status).toBe('queued')
  })

  it('returns the run resource while its output is still being redacted', async () => {
    mocks.readRun.mockResolvedValueOnce({
      ...baseStatus,
      status: 'redacting',
      level: 'info',
      error: null,
    })

    const response = await callStatus()

    expect(response.status).toBe(200)
    expect((await response.json()).data.status).toBe('redacting')
  })

  it('returns the public pause context without its internal paused-execution ID', async () => {
    mocks.readRun.mockResolvedValueOnce({
      ...baseStatus,
      status: 'paused',
      level: 'info',
      endedAt: null,
      totalDurationMs: null,
      error: null,
      paused: {
        contextId: 'context-1',
        pausedAt: '2026-07-31T00:00:01.000Z',
        resumeAt: null,
        pauseKind: 'human',
        blockedOnBlockId: 'approval-block',
        automaticResumeWaitingReason: null,
        pausedExecutionId: 'paused-execution-1',
        pausePointCount: 1,
        resumedCount: 0,
      },
    })

    const body = await (await callStatus()).json()

    expect(body.data.paused.contextId).toBe('context-1')
    expect(body.data.paused).not.toHaveProperty('pausedExecutionId')
  })

  it('conceals canonical run authorization failures as absence', async () => {
    mocks.readRun.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await callStatus()

    expect(response.status).toBe(404)
    expect((await response.json()).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Run not found',
    })
  })

  it('rejects missing API keys before reading the run', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(
      new MockV2ApiKeyUnauthenticatedError('API key required')
    )

    const response = await callStatus()

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(mocks.readRun).not.toHaveBeenCalled()
  })

  it('keeps cancel on its semantic application operation', async () => {
    const response = await cancelPost(createMockRequest('POST', undefined, {}), {
      params: Promise.resolve({ id: 'workflow-1', runId: 'run-1' }),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      success: true,
      runId: 'run-1',
      reason: 'recorded',
    })
    expect(mocks.cancel).toHaveBeenCalledWith({
      principal,
      input: { workflowId: 'workflow-1', runId: 'run-1' },
      request: expect.anything(),
    })
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(v2RouteMocks.operationRate).toHaveBeenCalledWith(
      'v2:workflows.runs.cancel:api-key:key-1',
      expect.anything()
    )
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('keeps cancellation request-rate admission separate from run control', async () => {
    v2RouteMocks.operationRate
      .mockResolvedValueOnce(OPERATION_RATE_LIMIT_DENIED)
      .mockResolvedValueOnce(V2_OPERATION_RATE_LIMIT_ALLOWED)

    const response = await cancelPost(createMockRequest('POST', undefined, {}), {
      params: Promise.resolve({ id: 'workflow-1', runId: 'run-1' }),
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('returns forbidden when the current workspace role cannot cancel the run', async () => {
    mocks.cancel.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())

    const response = await cancelPost(createMockRequest('POST', undefined, {}), {
      params: Promise.resolve({ id: 'workflow-1', runId: 'run-1' }),
    })

    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Insufficient workspace permissions',
    })
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('projects cancellation analytics only after a successful personal-key result', async () => {
    v2RouteMocks.authenticate.mockResolvedValueOnce({
      ...auth,
      principal: { kind: 'personal_api_key', userId: 'key-user', keyId: 'personal-key' },
      rolloutUserId: 'key-user',
      rateLimitSubjectIds: ['api-key:personal-key', 'user:key-user'],
      keyType: 'personal',
    })

    const response = await cancelPost(createMockRequest('POST', undefined, {}), {
      params: Promise.resolve({ id: 'workflow-1', runId: 'run-1' }),
    })

    expect(response.status).toBe(200)
    expect(mocks.capture).toHaveBeenCalledOnce()
    expect(mocks.capture).toHaveBeenCalledWith(
      'key-user',
      'workflow_execution_cancelled',
      { workflow_id: 'workflow-1', workspace_id: 'workspace-1' },
      { groups: { workspace: 'workspace-1' } }
    )
  })
})
