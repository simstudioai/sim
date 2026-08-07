/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  dbChainMockFns,
  resetDbChainMock,
  workflowAuthzMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthenticateV2ApiKey, mockGetWorkflowExecutionStatus, mockCancel } = vi.hoisted(() => ({
  mockAuthenticateV2ApiKey: vi.fn(),
  mockGetWorkflowExecutionStatus: vi.fn(),
  mockCancel: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  authenticateV2ApiKey: mockAuthenticateV2ApiKey,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBillingSettings: vi.fn().mockResolvedValue({ allowPersonalApiKeys: true }),
}))

vi.mock('@/lib/workflows/executor/execution-status', () => ({
  getWorkflowExecutionStatus: mockGetWorkflowExecutionStatus,
}))

vi.mock('@/lib/execution/cancel-workflow-execution', () => ({
  cancelWorkflowExecution: mockCancel,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { POST as cancelPost } from './cancel/route'
import { GET } from './route'

const mockAuthorize = workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission

const workflowRecord = {
  id: 'workflow-1',
  userId: 'owner-1',
  workspaceId: 'workspace-1',
}

function callStatus(query = '') {
  const req = createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/v2/workflows/workflow-1/runs/exec-1${query}`
  )
  return GET(req, { params: Promise.resolve({ id: 'workflow-1', runId: 'exec-1' }) })
}

describe('v2 runs status + cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAuthenticateV2ApiKey.mockResolvedValue({
      authenticated: true,
      actorUserId: 'key-user-1',
      principalUserId: 'key-user-1',
      keyId: 'key-1',
      keyType: 'personal',
    })
    mockAuthorize.mockResolvedValue({ allowed: true, workflow: workflowRecord })
  })

  it('returns the run resource with a structured error', async () => {
    mockGetWorkflowExecutionStatus.mockResolvedValue({
      executionId: 'exec-1',
      workflowId: 'workflow-1',
      status: 'failed',
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
    })

    const res = await callStatus()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('failed')
    expect(body.data.runId).toBe('exec-1')
    expect(body.data.error.code).toBe('EXECUTION_FAILED')
    expect(body.data.error.message).toBe('Send Email: Invalid credentials')
    expect(body.data.durationMs).toBe(5000)
  })

  it('returns the queued run resource before the log row exists', async () => {
    mockGetWorkflowExecutionStatus.mockResolvedValue({
      executionId: 'exec-1',
      workflowId: 'workflow-1',
      status: 'queued',
      trigger: 'api',
      level: 'info',
      startedAt: '2026-07-31T00:00:00.000Z',
      endedAt: null,
      totalDurationMs: null,
      paused: null,
      cost: null,
      error: null,
      finalOutput: null,
      blockOutputs: null,
    })

    const res = await callStatus()

    expect(res.status).toBe(200)
    expect((await res.json()).data.status).toBe('queued')
  })

  it('returns the resume context for a paused execution', async () => {
    mockGetWorkflowExecutionStatus.mockResolvedValue({
      executionId: 'exec-1',
      workflowId: 'workflow-1',
      status: 'paused',
      trigger: 'api',
      level: 'info',
      startedAt: '2026-07-31T00:00:00.000Z',
      endedAt: null,
      totalDurationMs: null,
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
      cost: null,
      error: null,
      finalOutput: null,
      blockOutputs: null,
    })

    const body = await (await callStatus()).json()

    expect(body.data.paused.contextId).toBe('context-1')
    expect(body.data.paused).not.toHaveProperty('pausedExecutionId')
  })

  it('404s when neither a log row nor a matching job exists', async () => {
    mockGetWorkflowExecutionStatus.mockResolvedValue(null)

    const res = await callStatus()

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('masks cross-workspace access as 404', async () => {
    mockAuthenticateV2ApiKey.mockResolvedValue({
      authenticated: true,
      actorUserId: 'payer-1',
      principalUserId: 'key-user-1',
      keyId: 'key-1',
      keyType: 'workspace',
      workspaceId: 'other-workspace',
      billingAttribution: { organizationId: null },
    })
    dbChainMockFns.limit.mockResolvedValue([workflowRecord])

    const res = await callStatus()

    expect(res.status).toBe(404)
    expect(mockAuthorize).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      userId: 'key-user-1',
      action: 'read',
    })
    expect(mockGetWorkflowExecutionStatus).not.toHaveBeenCalled()
  })

  it('cancels through the shared lib and returns the tightened result', async () => {
    mockCancel.mockResolvedValue({
      success: true,
      executionId: 'exec-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'recorded',
    })

    const req = createMockRequest('POST', undefined, {})
    const res = await cancelPost(req, {
      params: Promise.resolve({ id: 'workflow-1', runId: 'exec-1' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ success: true, runId: 'exec-1', reason: 'recorded' })
    expect(mockCancel).toHaveBeenCalledWith({
      executionId: 'exec-1',
      workflowId: 'workflow-1',
      userId: 'key-user-1',
      workspaceId: 'workspace-1',
    })
  })

  it('401s without an API key (no session/anonymous path on runs)', async () => {
    mockAuthenticateV2ApiKey.mockResolvedValue({ authenticated: false, error: 'API key required' })

    const res = await callStatus()

    expect(res.status).toBe(401)
  })
})
