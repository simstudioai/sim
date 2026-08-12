/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockV2ApiKeyUnauthenticatedError } = vi.hoisted(() => {
  class MockV2ApiKeyUnauthenticatedError extends Error {}
  return {
    MockV2ApiKeyUnauthenticatedError,
    mocks: {
      authenticate: vi.fn(),
      cancel: vi.fn(),
      capture: vi.fn(),
      checkOperationRate: vi.fn(),
      checkPreAuthRate: vi.fn(),
      readRun: vi.fn(),
    },
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: MockV2ApiKeyUnauthenticatedError,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect = mocks.checkPreAuthRate
    checkRateLimitDirectOrThrow = mocks.checkOperationRate
  },
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

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
    mocks.authenticate.mockResolvedValue(auth)
    mocks.checkPreAuthRate.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2026-08-05T01:00:00Z'),
    })
    mocks.checkOperationRate.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2026-08-05T01:00:00Z'),
    })
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
    mocks.authenticate.mockRejectedValueOnce(
      new MockV2ApiKeyUnauthenticatedError('API key required')
    )

    const response = await callStatus()

    expect(response.status).toBe(401)
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
    expect(mocks.checkOperationRate).toHaveBeenCalledTimes(2)
    expect(mocks.checkOperationRate).toHaveBeenCalledWith(
      'v2:workflows.runs.cancel:api-key:key-1',
      expect.anything()
    )
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('keeps cancellation request-rate admission separate from run control', async () => {
    mocks.checkOperationRate
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: new Date('2026-08-05T01:00:00Z'),
        retryAfterMs: 5_000,
      })
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 99,
        resetAt: new Date('2026-08-05T01:00:00Z'),
      })

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
    mocks.authenticate.mockResolvedValueOnce({
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
