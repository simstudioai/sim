/**
 * @vitest-environment node
 */

import {
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  hybridAuthMockFns,
  loggingSessionMock,
  requestUtilsMockFns,
  resetDbChainMock,
  workflowAuthzMockFns,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncJobEnqueueError } from '@/lib/core/async-jobs/types'

const {
  mockAssertBillingAttributionSnapshot,
  mockClaimExecutionId,
  mockEnqueue,
  mockExecuteWorkflowCore,
  mockGenerateId,
  mockGetWorkspaceBillingSettings,
  mockHandlePostExecutionPauseState,
  mockHasDurableExecutionOwner,
  mockReleaseExecutionIdClaim,
  mockReleaseExecutionSlot,
  mockRequireBillingAttributionHeader,
  mockShouldExecuteInline,
  mockStartJob,
  mockCompleteJob,
  mockMarkJobFailed,
  mockExecuteWorkflowJob,
  mockValidatePublicApiAllowed,
} = vi.hoisted(() => ({
  mockAssertBillingAttributionSnapshot: vi.fn((value: unknown) => {
    if (!value || typeof value !== 'object') {
      throw new Error('Billing attribution snapshot must be an object')
    }
    return value
  }),
  mockClaimExecutionId: vi.fn(),
  mockEnqueue: vi.fn().mockResolvedValue('job-123'),
  mockExecuteWorkflowCore: vi.fn(),
  mockGenerateId: vi.fn(() => 'execution-123'),
  mockGetWorkspaceBillingSettings: vi.fn(),
  mockHandlePostExecutionPauseState: vi.fn(),
  mockHasDurableExecutionOwner: vi.fn(),
  mockReleaseExecutionIdClaim: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockShouldExecuteInline: vi.fn(() => false),
  mockStartJob: vi.fn(),
  mockCompleteJob: vi.fn(),
  mockMarkJobFailed: vi.fn(),
  mockExecuteWorkflowJob: vi.fn(),
  mockValidatePublicApiAllowed: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: mockAssertBillingAttributionSnapshot,
  requireBillingAttributionHeader: mockRequireBillingAttributionHeader,
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBillingSettings: mockGetWorkspaceBillingSettings,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  PublicApiNotAllowedError: class PublicApiNotAllowedError extends Error {},
  validatePublicApiAllowed: mockValidatePublicApiAllowed,
}))

const mockCheckHybridAuth = hybridAuthMockFns.mockCheckHybridAuth
const mockPreprocessExecution = executionPreprocessingMockFns.mockPreprocessExecution

const mockAuthorizeWorkflowByWorkspacePermission =
  workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: mockExecuteWorkflowCore,
}))

vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: mockHandlePostExecutionPauseState,
}))

vi.mock('@/lib/workflows/executor/execution-id-claim', () => ({
  claimExecutionId: mockClaimExecutionId,
  hasDurableExecutionOwner: mockHasDurableExecutionOwner,
  releaseExecutionIdClaim: mockReleaseExecutionIdClaim,
}))

vi.mock('@/lib/execution/payloads/store', () => ({
  storeLargeValue: vi.fn(async (_value, _json, size: number) => ({
    __simLargeValueRef: true,
    version: 1,
    id: 'lv_abcdefghijkl',
    kind: 'string',
    size,
  })),
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn().mockResolvedValue({
    enqueue: mockEnqueue,
    startJob: mockStartJob,
    completeJob: mockCompleteJob,
    markJobFailed: mockMarkJobFailed,
  }),
  shouldExecuteInline: mockShouldExecuteInline,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn().mockReturnValue('http://localhost:3000'),
  getOllamaUrl: vi.fn().mockReturnValue('http://localhost:11434'),
}))

vi.mock('@/lib/execution/call-chain', () => ({
  SIM_VIA_HEADER: 'x-sim-via',
  parseCallChain: vi.fn().mockReturnValue([]),
  validateCallChain: vi.fn().mockReturnValue(null),
  buildNextCallChain: vi.fn().mockReturnValue(['workflow-1']),
}))

vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/background/workflow-execution', () => ({
  executeWorkflowJob: mockExecuteWorkflowJob,
}))

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
  generateShortId: vi.fn(() => 'mock-short-id'),
  isValidUuid: vi.fn((v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ),
}))

import { getAdmissionGateStatus, tryAdmit } from '@/lib/core/admission/gate'
import { storeLargeValue } from '@/lib/execution/payloads/store'
import { POST } from './route'

const billingAttribution = {
  actorUserId: 'actor-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'actor-1',
  billingEntity: { type: 'user' as const, id: 'actor-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

function createSessionReplayRequest(
  executionId: string,
  executionMode: 'async' | 'sync' = 'async'
): NextRequest {
  return createMockRequest(
    'POST',
    {
      input: { hello: 'world' },
      executionId,
      isClientSession: true,
    },
    {
      'Content-Type': 'application/json',
      Cookie: 'session=value',
      ...(executionMode === 'async' ? { 'X-Execution-Mode': 'async' } : {}),
    }
  )
}

interface ExecutionCallerCase {
  caseName: string
  authResult: Record<string, unknown>
  headers: Record<string, string>
  usesExternalInput: boolean
  isPublic?: boolean
}

const EXECUTION_CALLERS: ExecutionCallerCase[] = [
  {
    caseName: 'session',
    authResult: {
      success: true,
      userId: 'session-user-1',
      authType: 'session',
    },
    headers: { Cookie: 'session=value' },
    usesExternalInput: false,
  },
  {
    caseName: 'personal API key',
    authResult: {
      success: true,
      userId: 'personal-key-user-1',
      authType: 'api_key',
      apiKeyType: 'personal',
    },
    headers: { 'X-API-Key': 'personal-key' },
    usesExternalInput: true,
  },
  {
    caseName: 'workspace API key',
    authResult: {
      success: true,
      userId: 'workspace-key-user-1',
      workspaceId: 'workspace-1',
      authType: 'api_key',
      apiKeyType: 'workspace',
    },
    headers: { 'X-API-Key': 'workspace-key' },
    usesExternalInput: true,
  },
  {
    caseName: 'public API',
    authResult: {
      success: false,
      error: 'Unauthorized',
    },
    headers: {},
    usesExternalInput: true,
    isPublic: true,
  },
  {
    caseName: 'internal JWT',
    authResult: {
      success: true,
      userId: 'internal-user-1',
      authType: 'internal_jwt',
    },
    headers: { Authorization: 'Bearer internal-token' },
    usesExternalInput: true,
  },
]

const EXTERNAL_EXECUTION_CALLERS = EXECUTION_CALLERS.filter(
  ({ usesExternalInput }) => usesExternalInput
)

function configureExecutionCaller(caller: ExecutionCallerCase, requestCount = 1): void {
  mockCheckHybridAuth.mockResolvedValue(caller.authResult)
  if (!caller.isPublic) return

  for (let request = 0; request < requestCount; request++) {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        isPublicApi: true,
        isDeployed: true,
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
    ])
  }
}

function createCallerExecutionRequest(
  caller: ExecutionCallerCase,
  executionId?: string,
  executionMode: 'async' | 'sync' = 'async'
): NextRequest {
  const input = { hello: 'world' }
  const body = caller.usesExternalInput
    ? { ...input, ...(executionId ? { executionId } : {}) }
    : { input, ...(executionId ? { executionId } : {}) }

  return createMockRequest('POST', body, {
    'Content-Type': 'application/json',
    ...(executionMode === 'async' ? { 'X-Execution-Mode': 'async' } : {}),
    ...caller.headers,
  })
}

describe('workflow execute async route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockShouldExecuteInline.mockReturnValue(false)
    mockExecuteWorkflowJob.mockResolvedValue({ success: true })
    mockGenerateId.mockReset().mockReturnValue('execution-123')
    mockClaimExecutionId.mockImplementation(async (executionId: string) => ({
      key: `workflow-execution-id:${executionId}`,
      token: `token-${executionId}`,
    }))
    mockHasDurableExecutionOwner.mockResolvedValue(false)

    requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('req-12345678')
    workflowsUtilsMockFns.mockWorkflowHasResponseBlock.mockReturnValue(false)
    hybridAuthMockFns.mockHasExternalApiCredentials.mockReturnValue(true)
    mockGetWorkspaceBillingSettings.mockResolvedValue({
      billedAccountUserId: 'owner-1',
      allowPersonalApiKeys: true,
    })
    mockRequireBillingAttributionHeader.mockReturnValue(undefined)
    mockValidatePublicApiAllowed.mockResolvedValue(undefined)

    mockCheckHybridAuth.mockResolvedValue({
      success: true,
      userId: 'session-user-1',
      authType: 'session',
    })

    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      workflow: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
    })

    mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
      billingAttribution,
    })
    workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState.mockResolvedValue(null)
    workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables.mockResolvedValue(null)
    mockExecuteWorkflowCore.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { ok: true },
      metadata: {
        duration: 100,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
      },
    })
    mockHandlePostExecutionPauseState.mockResolvedValue(undefined)
  })

  it('queues async execution with matching correlation metadata', async () => {
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-Execution-Mode': 'async',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.executionId).toBe('execution-123')
    expect(body.jobId).toBe('job-123')
    expect(mockClaimExecutionId).toHaveBeenCalledWith('execution-123')
    expect(mockEnqueue).toHaveBeenCalledWith(
      'workflow-execution',
      expect.objectContaining({
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        executionId: 'execution-123',
        executionMode: 'async',
        admissionCompleted: true,
        billingAttribution,
      }),
      expect.objectContaining({
        jobId: 'workflow-execution:execution-123',
        metadata: expect.objectContaining({
          workflowId: 'workflow-1',
          userId: 'actor-1',
          workspaceId: 'workspace-1',
          correlation: expect.objectContaining({
            executionId: 'execution-123',
            requestId: 'req-12345678',
            source: 'workflow',
            workflowId: 'workflow-1',
            triggerType: 'manual',
          }),
        }),
      })
    )
  })

  it('retains the admission ticket until database-backed async execution finishes', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    let resolveInlineExecution!: () => void
    const inlineExecution = new Promise<void>((resolve) => {
      resolveInlineExecution = resolve
    })
    mockExecuteWorkflowJob.mockReturnValueOnce(inlineExecution)

    const response = await POST(
      createMockRequest(
        'POST',
        { input: { hello: 'world' } },
        {
          'Content-Type': 'application/json',
          'X-Execution-Mode': 'async',
        }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(202)
    expect(getAdmissionGateStatus().inflight).toBe(1)

    resolveInlineExecution()
    await vi.waitFor(() => {
      expect(getAdmissionGateStatus().inflight).toBe(0)
    })
    expect(mockCompleteJob).toHaveBeenCalledWith('job-123', undefined)
  })

  it('applies admission backpressure to session-backed async executions', async () => {
    hybridAuthMockFns.mockHasExternalApiCredentials.mockReturnValue(false)
    const heldTickets = Array.from({ length: getAdmissionGateStatus().maxInflight }, () =>
      tryAdmit()
    ).filter((ticket): ticket is NonNullable<ReturnType<typeof tryAdmit>> => ticket !== null)

    try {
      const response = await POST(
        createSessionReplayRequest('66666666-6666-4666-8666-666666666666'),
        {
          params: Promise.resolve({ id: 'workflow-1' }),
        }
      )

      expect(response.status).toBe(429)
      expect(mockCheckHybridAuth).not.toHaveBeenCalled()
      expect(mockPreprocessExecution).not.toHaveBeenCalled()
    } finally {
      for (const ticket of heldTickets) {
        ticket.release()
      }
    }
  })

  it('leaves session-backed synchronous executions on their existing path', async () => {
    hybridAuthMockFns.mockHasExternalApiCredentials.mockReturnValue(false)
    const heldTickets = Array.from({ length: getAdmissionGateStatus().maxInflight }, () =>
      tryAdmit()
    ).filter((ticket): ticket is NonNullable<ReturnType<typeof tryAdmit>> => ticket !== null)

    try {
      const response = await POST(
        createSessionReplayRequest('77777777-7777-4777-8777-777777777777', 'sync'),
        { params: Promise.resolve({ id: 'workflow-1' }) }
      )

      expect(response.status).not.toBe(429)
      expect(mockCheckHybridAuth).toHaveBeenCalled()
    } finally {
      for (const ticket of heldTickets) {
        ticket.release()
      }
    }
  })

  it('preserves a first-use execution ID supplied by an authenticated session', async () => {
    const requestedExecutionId = '11111111-1111-4111-8111-111111111111'
    const response = await POST(createSessionReplayRequest(requestedExecutionId), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ executionId: requestedExecutionId })
    expect(mockClaimExecutionId).toHaveBeenCalledWith(requestedExecutionId)
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: requestedExecutionId })
    )
    expect(mockEnqueue).toHaveBeenCalledWith(
      'workflow-execution',
      expect.objectContaining({
        executionId: requestedExecutionId,
        input: { hello: 'world' },
      }),
      expect.objectContaining({
        jobId: `workflow-execution:${requestedExecutionId}`,
      })
    )
  })

  it('rejects sequential replay of a claimed session execution ID before preprocessing', async () => {
    const requestedExecutionId = '22222222-2222-4222-8222-222222222222'
    mockClaimExecutionId
      .mockResolvedValueOnce({
        key: `workflow-execution-id:${requestedExecutionId}`,
        token: 'claim-token',
      })
      .mockResolvedValueOnce(null)

    const firstResponse = await POST(createSessionReplayRequest(requestedExecutionId), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })
    const replayResponse = await POST(createSessionReplayRequest(requestedExecutionId), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(firstResponse.status).toBe(202)
    expect(replayResponse.status).toBe(409)
    await expect(replayResponse.json()).resolves.toMatchObject({
      code: 'EXECUTION_ID_CONFLICT',
      executionId: requestedExecutionId,
    })
    expect(mockPreprocessExecution).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })

  it('allows only one concurrent request to use the same session execution ID', async () => {
    const requestedExecutionId = '33333333-3333-4333-8333-333333333333'
    mockClaimExecutionId
      .mockResolvedValueOnce({
        key: `workflow-execution-id:${requestedExecutionId}`,
        token: 'claim-token',
      })
      .mockResolvedValueOnce(null)

    const responses = await Promise.all([
      POST(createSessionReplayRequest(requestedExecutionId), {
        params: Promise.resolve({ id: 'workflow-1' }),
      }),
      POST(createSessionReplayRequest(requestedExecutionId), {
        params: Promise.resolve({ id: 'workflow-1' }),
      }),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([202, 409])
    expect(mockPreprocessExecution).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })

  it('releases a claimed session execution ID when preprocessing rejects the run', async () => {
    const requestedExecutionId = '44444444-4444-4444-8444-444444444444'
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message: 'Not admitted', statusCode: 402 },
    })

    const response = await POST(createSessionReplayRequest(requestedExecutionId), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(402)
    expect(mockReleaseExecutionIdClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `workflow-execution-id:${requestedExecutionId}`,
      })
    )
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('fails closed before preprocessing when the durable claim store is unavailable', async () => {
    const requestedExecutionId = '55555555-5555-4555-8555-555555555555'
    mockClaimExecutionId.mockRejectedValueOnce(new Error('database unavailable'))

    const response = await POST(createSessionReplayRequest(requestedExecutionId), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Workflow execution identity is temporarily unavailable',
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it.each(EXECUTION_CALLERS)(
    'honors a first-use execution ID supplied by a $caseName caller',
    async (caller) => {
      const requestedExecutionId = '66666666-6666-4666-8666-666666666666'
      configureExecutionCaller(caller)

      const response = await POST(createCallerExecutionRequest(caller, requestedExecutionId), {
        params: Promise.resolve({ id: 'workflow-1' }),
      })

      expect(response.status).toBe(202)
      await expect(response.json()).resolves.toMatchObject({ executionId: requestedExecutionId })
      expect(mockClaimExecutionId).toHaveBeenCalledWith(requestedExecutionId)
      expect(mockPreprocessExecution).toHaveBeenCalledWith(
        expect.objectContaining({ executionId: requestedExecutionId })
      )
      expect(mockEnqueue).toHaveBeenCalledWith(
        'workflow-execution',
        expect.objectContaining({ executionId: requestedExecutionId }),
        expect.any(Object)
      )
    }
  )

  it.each(EXECUTION_CALLERS)(
    'returns 409 for a duplicate execution ID from a $caseName caller',
    async (caller) => {
      const requestedExecutionId = '77777777-7777-4777-8777-777777777777'
      configureExecutionCaller(caller, 2)
      mockClaimExecutionId
        .mockResolvedValueOnce({
          key: `workflow-execution-id:${requestedExecutionId}`,
          token: 'claim-token',
        })
        .mockResolvedValueOnce(null)

      const firstResponse = await POST(createCallerExecutionRequest(caller, requestedExecutionId), {
        params: Promise.resolve({ id: 'workflow-1' }),
      })
      const duplicateResponse = await POST(
        createCallerExecutionRequest(caller, requestedExecutionId),
        {
          params: Promise.resolve({ id: 'workflow-1' }),
        }
      )

      expect(firstResponse.status).toBe(202)
      expect(duplicateResponse.status).toBe(409)
      await expect(duplicateResponse.json()).resolves.toMatchObject({
        code: 'EXECUTION_ID_CONFLICT',
        executionId: requestedExecutionId,
      })
      expect(mockPreprocessExecution).toHaveBeenCalledTimes(1)
      expect(mockEnqueue).toHaveBeenCalledTimes(1)
    }
  )

  it.each(EXTERNAL_EXECUTION_CALLERS)(
    'preserves a legacy body executionId in $caseName flat workflow input',
    async (caller) => {
      const requestedExecutionId = '88888888-8888-4888-8888-888888888888'
      configureExecutionCaller(caller)

      const response = await POST(createCallerExecutionRequest(caller, requestedExecutionId), {
        params: Promise.resolve({ id: 'workflow-1' }),
      })

      expect(response.status).toBe(202)
      expect(mockEnqueue).toHaveBeenCalledWith(
        'workflow-execution',
        expect.objectContaining({
          executionId: requestedExecutionId,
          input: { hello: 'world', executionId: requestedExecutionId },
        }),
        expect.any(Object)
      )
    }
  )

  it.each(EXTERNAL_EXECUTION_CALLERS)(
    'uses the execution header for $caseName transport identity while preserving the body field',
    async (caller) => {
      const bodyExecutionId = 'workflow data with spaces'
      const headerExecutionId = '99999999-9999-4999-8999-999999999999'
      configureExecutionCaller(caller)
      const request = createCallerExecutionRequest(caller, bodyExecutionId)
      request.headers.set('X-Execution-Id', headerExecutionId)

      const response = await POST(request, {
        params: Promise.resolve({ id: 'workflow-1' }),
      })

      expect(response.status).toBe(202)
      await expect(response.json()).resolves.toMatchObject({ executionId: headerExecutionId })
      expect(mockClaimExecutionId).toHaveBeenCalledWith(headerExecutionId)
      expect(mockEnqueue).toHaveBeenCalledWith(
        'workflow-execution',
        expect.objectContaining({
          executionId: headerExecutionId,
          input: { hello: 'world', executionId: bodyExecutionId },
        }),
        expect.objectContaining({
          jobId: `workflow-execution:${headerExecutionId}`,
        })
      )
    }
  )

  it('keeps legacy body execution ID validation when no header is present', async () => {
    const caller = EXECUTION_CALLERS[1]
    configureExecutionCaller(caller)

    const response = await POST(createCallerExecutionRequest(caller, 'invalid execution id'), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request body',
    })
    expect(mockClaimExecutionId).not.toHaveBeenCalled()
  })

  it('rejects an invalid execution identity header before claiming an ID', async () => {
    const caller = EXECUTION_CALLERS[1]
    configureExecutionCaller(caller)
    const request = createCallerExecutionRequest(caller)
    request.headers.set('X-Execution-Id', 'invalid execution id')

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid execution ID header',
    })
    expect(mockClaimExecutionId).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('keeps session input nested when executionId is supplied in the body', async () => {
    const requestedExecutionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

    const response = await POST(createSessionReplayRequest(requestedExecutionId), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(202)
    expect(mockEnqueue).toHaveBeenCalledWith(
      'workflow-execution',
      expect.objectContaining({
        executionId: requestedExecutionId,
        input: { hello: 'world' },
      }),
      expect.any(Object)
    )
  })

  it('retries a generated execution ID collision with a fresh server ID', async () => {
    mockGenerateId
      .mockReturnValueOnce('generated-collision')
      .mockReturnValueOnce('generated-success')
    mockClaimExecutionId.mockResolvedValueOnce(null).mockResolvedValueOnce({
      key: 'workflow-execution-id:generated-success',
      token: 'claim-token',
    })

    const response = await POST(createCallerExecutionRequest(EXECUTION_CALLERS[0]), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ executionId: 'generated-success' })
    expect(mockClaimExecutionId.mock.calls.map(([executionId]) => executionId)).toEqual([
      'generated-collision',
      'generated-success',
    ])
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'generated-success' })
    )
  })

  it('rejects a workspace API key for another workspace before preprocessing', async () => {
    const caller = EXECUTION_CALLERS[2]
    configureExecutionCaller({
      ...caller,
      authResult: { ...caller.authResult, workspaceId: 'workspace-2' },
    })

    const response = await POST(createCallerExecutionRequest(caller), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'API key is not authorized for this workspace',
    })
    expect(mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalled()
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockClaimExecutionId).not.toHaveBeenCalled()
  })

  it('rejects a personal API key disabled by workspace policy before preprocessing', async () => {
    const caller = EXECUTION_CALLERS[1]
    configureExecutionCaller(caller)
    mockGetWorkspaceBillingSettings.mockResolvedValueOnce({
      billedAccountUserId: 'owner-1',
      allowPersonalApiKeys: false,
    })

    const response = await POST(createCallerExecutionRequest(caller), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Personal API keys are not allowed for this workspace',
    })
    expect(mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalled()
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockClaimExecutionId).not.toHaveBeenCalled()
  })

  it('releases a transient execution ID claim when synchronous startup fails', async () => {
    const caller = EXECUTION_CALLERS[0]
    configureExecutionCaller(caller)
    mockExecuteWorkflowCore.mockRejectedValueOnce(new Error('startup failed'))

    const response = await POST(createCallerExecutionRequest(caller, undefined, 'sync'), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(500)
    expect(mockReleaseExecutionIdClaim).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'workflow-execution-id:execution-123' })
    )
  })

  it('retains the execution ID claim after a durable log owner is established', async () => {
    const caller = EXECUTION_CALLERS[0]
    configureExecutionCaller(caller)
    mockHasDurableExecutionOwner.mockResolvedValueOnce(true)
    mockExecuteWorkflowCore.mockRejectedValueOnce(
      new Error('execution failed after logging started')
    )

    const response = await POST(createCallerExecutionRequest(caller, undefined, 'sync'), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(500)
    expect(mockReleaseExecutionIdClaim).not.toHaveBeenCalled()
  })

  it('releases the admission reservation when enqueue proves non-acceptance', async () => {
    mockEnqueue.mockRejectedValueOnce(
      new AsyncJobEnqueueError('queue rejected the job', {
        acceptance: 'rejected',
        retryable: false,
      })
    )
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-Execution-Mode': 'async',
      }
    )

    const response = await POST(req, { params: Promise.resolve({ id: 'workflow-1' }) })

    expect(response.status).toBe(500)
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-123')
    expect(mockReleaseExecutionIdClaim).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'workflow-execution-id:execution-123' })
    )
  })

  it('retries an accepted-response-lost enqueue with the same deterministic job ID', async () => {
    mockEnqueue.mockRejectedValueOnce(
      new AsyncJobEnqueueError('enqueue response was lost', {
        acceptance: 'unknown',
        retryable: true,
      })
    )

    const response = await POST(
      createMockRequest(
        'POST',
        { input: { hello: 'world' } },
        {
          'Content-Type': 'application/json',
          'X-Execution-Mode': 'async',
        }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(202)
    expect(mockEnqueue).toHaveBeenCalledTimes(2)
    for (const [, , options] of mockEnqueue.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({ jobId: 'workflow-execution:execution-123' })
      )
    }
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
    expect(mockReleaseExecutionIdClaim).not.toHaveBeenCalled()
  })

  it('retains the reservation and execution claim when enqueue acceptance stays ambiguous', async () => {
    const ambiguousError = new AsyncJobEnqueueError('enqueue response was lost', {
      acceptance: 'unknown',
      retryable: true,
    })
    mockEnqueue.mockRejectedValueOnce(ambiguousError).mockRejectedValueOnce(ambiguousError)

    const response = await POST(
      createMockRequest(
        'POST',
        { input: { hello: 'world' } },
        {
          'Content-Type': 'application/json',
          'X-Execution-Mode': 'async',
        }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: 'ASYNC_ENQUEUE_AMBIGUOUS',
      executionId: 'execution-123',
    })
    expect(mockEnqueue).toHaveBeenCalledTimes(2)
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
    expect(mockReleaseExecutionIdClaim).not.toHaveBeenCalled()
  })

  it('retains ownership when a later rejection cannot disprove earlier acceptance', async () => {
    mockEnqueue
      .mockRejectedValueOnce(
        new AsyncJobEnqueueError('enqueue response was lost', {
          acceptance: 'unknown',
          retryable: true,
        })
      )
      .mockRejectedValueOnce(
        new AsyncJobEnqueueError('retry rejected', {
          acceptance: 'rejected',
          retryable: false,
        })
      )

    const response = await POST(
      createMockRequest(
        'POST',
        { input: { hello: 'world' } },
        {
          'Content-Type': 'application/json',
          'X-Execution-Mode': 'async',
        }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(503)
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
    expect(mockReleaseExecutionIdClaim).not.toHaveBeenCalled()
  })

  it.each([
    {
      caseName: 'missing actor',
      preprocessResult: {
        success: true,
        workflowRecord: {
          id: 'workflow-1',
          userId: 'owner-1',
          workspaceId: 'workspace-1',
        },
        billingAttribution,
      },
    },
    {
      caseName: 'missing workflow record',
      preprocessResult: {
        success: true,
        actorUserId: 'actor-1',
        billingAttribution,
      },
    },
    {
      caseName: 'missing billing attribution',
      preprocessResult: {
        success: true,
        actorUserId: 'actor-1',
        workflowRecord: {
          id: 'workflow-1',
          userId: 'owner-1',
          workspaceId: 'workspace-1',
        },
      },
    },
    {
      caseName: 'mismatched billing actor',
      preprocessResult: {
        success: true,
        actorUserId: 'actor-1',
        workflowRecord: {
          id: 'workflow-1',
          userId: 'owner-1',
          workspaceId: 'workspace-1',
        },
        billingAttribution: { ...billingAttribution, actorUserId: 'actor-2' },
      },
    },
    {
      caseName: 'mismatched billing workspace',
      preprocessResult: {
        success: true,
        actorUserId: 'actor-1',
        workflowRecord: {
          id: 'workflow-1',
          userId: 'owner-1',
          workspaceId: 'workspace-1',
        },
        billingAttribution: { ...billingAttribution, workspaceId: 'workspace-2' },
      },
    },
  ])(
    'rejects successful preprocessing with $caseName before enqueue',
    async ({ preprocessResult }) => {
      mockPreprocessExecution.mockResolvedValueOnce(preprocessResult)
      const req = createMockRequest(
        'POST',
        { input: { hello: 'world' } },
        {
          'Content-Type': 'application/json',
          'X-Execution-Mode': 'async',
        }
      )

      const response = await POST(req, { params: Promise.resolve({ id: 'workflow-1' }) })

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        error: 'Invalid execution context returned by preprocessing',
      })
      expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-123')
      expect(mockEnqueue).not.toHaveBeenCalled()
    }
  )

  it('reuses internal child-workflow billing attribution during preprocessing', async () => {
    const billingAttribution = {
      actorUserId: 'actor-1',
      workspaceId: 'workspace-1',
      organizationId: 'org-1',
      billedAccountUserId: 'owner-1',
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    }
    mockCheckHybridAuth.mockResolvedValue({
      success: true,
      userId: 'actor-1',
      authType: 'internal_jwt',
    })
    mockRequireBillingAttributionHeader.mockReturnValue(billingAttribution)

    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-Execution-Mode': 'async',
        'X-Sim-Billing-Attribution': 'snapshot',
      }
    )

    const response = await POST(req, { params: Promise.resolve({ id: 'workflow-1' }) })

    expect(response.status).toBe(202)
    expect(mockRequireBillingAttributionHeader).toHaveBeenCalledWith(req.headers, {
      actorUserId: 'actor-1',
      workspaceId: 'workspace-1',
    })
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ billingAttribution })
    )
  })

  it('rejects cross-site session requests before authorization work', async () => {
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'cross-site',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe('Access denied')
    expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('allows same-site session requests (multi-subdomain Run, e.g. www.<domain>)', async () => {
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-Execution-Mode': 'async',
        'Sec-Fetch-Site': 'same-site',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })

    expect(response.status).toBe(202)
    expect(mockEnqueue).toHaveBeenCalled()
  })

  it('rejects oversized request bodies before authorization work', async () => {
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'Content-Length': String(10 * 1024 * 1024 + 1),
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error).toContain('Workflow execution request body')
    expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
  })

  it('authenticates before rejecting oversized request bodies', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
      authType: 'api_key',
    })
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'Content-Length': String(10 * 1024 * 1024 + 1),
        'X-API-Key': 'invalid',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(mockCheckHybridAuth).toHaveBeenCalled()
  })

  it('returns 499 when a non-SSE execution is cancelled by client disconnect', async () => {
    const abortController = new AbortController()
    mockExecuteWorkflowCore.mockImplementationOnce(
      async ({ abortSignal }: { abortSignal: AbortSignal }) => {
        abortController.abort()
        expect(abortSignal.aborted).toBe(true)
        return {
          success: false,
          status: 'cancelled',
          output: { partial: true },
          metadata: {
            duration: 100,
            startTime: '2026-01-01T00:00:00Z',
            endTime: '2026-01-01T00:00:01Z',
          },
        }
      }
    )
    const req = new NextRequest('http://localhost:3000/api/workflows/workflow-1/execute', {
      method: 'POST',
      body: JSON.stringify({ input: { hello: 'world' } }),
      signal: abortController.signal,
    })
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(499)
    expect(body.error).toBe('Client cancelled request')
  })

  it('rejects large MCP bridge outputs instead of returning large-value refs', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'internal-user-1',
      authType: 'internal_jwt',
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: 'x'.repeat(10 * 1024 * 1024 + 1),
      metadata: {
        duration: 100,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
      },
    })
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-Sim-MCP-Tool-Call': 'true',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error).toContain('Workflow execution response')
    expect(storeLargeValue).not.toHaveBeenCalled()
  })

  it('does not trust client-spoofed MCP bridge headers on API key executions', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'api-user-1',
      authType: 'api_key',
      apiKeyType: 'personal',
    })
    workflowsUtilsMockFns.mockWorkflowHasResponseBlock.mockReturnValueOnce(true)
    workflowsUtilsMockFns.mockCreateHttpResponseFromBlock.mockResolvedValueOnce(
      Response.json({ response: 'plain text body' })
    )
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: { response: 'plain text body' },
      metadata: {
        duration: 100,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
      },
    })
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-API-Key': 'valid',
        'X-Sim-MCP-Tool-Call': 'true',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ response: 'plain text body' })
    expect(workflowsUtilsMockFns.mockCreateHttpResponseFromBlock).toHaveBeenCalled()
  })

  it('keeps trusted internal MCP bridge executions on the JSON envelope path', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'internal-user-1',
      authType: 'internal_jwt',
    })
    workflowsUtilsMockFns.mockWorkflowHasResponseBlock.mockReturnValueOnce(true)
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: { response: 'plain text body' },
      metadata: {
        duration: 100,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
      },
    })
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-Sim-MCP-Tool-Call': 'true',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      output: { response: 'plain text body' },
    })
    expect(workflowsUtilsMockFns.mockCreateHttpResponseFromBlock).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          input: { hello: 'world' },
        }),
      })
    )
  })

  it('preserves authenticated-user actor semantics for trusted MCP bridge calls', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'api-user-1',
      authType: 'internal_jwt',
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: { ok: true },
      metadata: {
        duration: 100,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
      },
    })
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-Sim-MCP-Tool-Call': 'true',
        'X-Sim-MCP-Tool-Actor': 'authenticated-user',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })

    expect(response.status).toBe(200)
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'api-user-1',
        useAuthenticatedUserAsActor: true,
      })
    )
    const executionCall = mockExecuteWorkflowCore.mock.calls[0][0]
    const snapshot =
      typeof executionCall.snapshot === 'string'
        ? JSON.parse(executionCall.snapshot)
        : executionCall.snapshot
    expect(snapshot.metadata.enforceCredentialAccess).toBe(true)
  })
})
