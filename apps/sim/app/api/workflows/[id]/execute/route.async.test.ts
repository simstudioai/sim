/**
 * @vitest-environment node
 */

import {
  createMockRequest,
  dbChainMockFns,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  hybridAuthMockFns,
  loggingSessionMock,
  loggingSessionMockFns,
  queueTableRows,
  requestUtilsMockFns,
  resetDbChainMock,
  resetEnvMock,
  schemaMock,
  setEnv,
  workflowAuthzMockFns,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncJobEnqueueError } from '@/lib/core/async-jobs/types'

const {
  mockAssertBillingAttributionSnapshot,
  mockClaimExecutionId,
  mockClaimWorkflowToolExecution,
  mockEnqueue,
  mockExecuteWorkflowCore,
  mockGenerateId,
  mockGetWorkspaceBillingSettings,
  mockGetAsyncToolCall,
  mockGetRunSegment,
  mockCreateExecutionEventWriter,
  mockFlushExecutionStreamReplayBuffer,
  mockHandlePostExecutionPauseState,
  mockHasDurableExecutionOwner,
  mockInitializeExecutionStreamMeta,
  mockSetExecutionMeta,
  mockReleaseExecutionIdClaim,
  mockReleaseExecutionSlot,
  mockReleaseWorkflowToolExecutionClaim,
  mockRequireBillingAttributionHeader,
  mockValidatePublicApiAllowed,
} = vi.hoisted(() => ({
  mockAssertBillingAttributionSnapshot: vi.fn((value: unknown) => {
    if (!value || typeof value !== 'object') {
      throw new Error('Billing attribution snapshot must be an object')
    }
    return value
  }),
  mockClaimExecutionId: vi.fn(),
  mockClaimWorkflowToolExecution: vi.fn(),
  mockEnqueue: vi.fn().mockResolvedValue('job-123'),
  mockExecuteWorkflowCore: vi.fn(),
  mockGenerateId: vi.fn(() => 'execution-123'),
  mockGetWorkspaceBillingSettings: vi.fn(),
  mockGetAsyncToolCall: vi.fn(),
  mockGetRunSegment: vi.fn(),
  mockCreateExecutionEventWriter: vi.fn(),
  mockFlushExecutionStreamReplayBuffer: vi.fn(),
  mockHandlePostExecutionPauseState: vi.fn(),
  mockHasDurableExecutionOwner: vi.fn(),
  mockInitializeExecutionStreamMeta: vi.fn(),
  mockSetExecutionMeta: vi.fn(),
  mockReleaseExecutionIdClaim: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockReleaseWorkflowToolExecutionClaim: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockValidatePublicApiAllowed: vi.fn(),
}))

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

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  claimWorkflowToolExecution: mockClaimWorkflowToolExecution,
  getAsyncToolCall: mockGetAsyncToolCall,
  getRunSegment: mockGetRunSegment,
  releaseWorkflowToolExecutionClaim: mockReleaseWorkflowToolExecutionClaim,
}))

vi.mock('@/lib/execution/event-buffer', () => ({
  createExecutionEventWriter: mockCreateExecutionEventWriter,
  flushExecutionStreamReplayBuffer: mockFlushExecutionStreamReplayBuffer,
  initializeExecutionStreamMeta: mockInitializeExecutionStreamMeta,
  setExecutionMeta: mockSetExecutionMeta,
  LIVE_ONLY_EXECUTION_EVENT_TYPES: new Set(),
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
    startJob: vi.fn(),
    completeJob: vi.fn(),
    markJobFailed: vi.fn(),
  }),
  shouldExecuteInline: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/execution/call-chain', () => ({
  SIM_VIA_HEADER: 'x-sim-via',
  parseCallChain: vi.fn().mockReturnValue([]),
  validateCallChain: vi.fn().mockReturnValue(null),
  buildNextCallChain: vi.fn().mockReturnValue(['workflow-1']),
}))

vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/background/workflow-execution', () => ({
  executeWorkflowJob: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
  generateShortId: vi.fn(() => 'mock-short-id'),
  isValidUuid: vi.fn((v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ),
}))

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

function createSessionReplayRequest(executionId: string): NextRequest {
  return createMockRequest(
    'POST',
    {
      input: { hello: 'world' },
      executionId,
      isClientSession: true,
    },
    {
      'Content-Type': 'application/json',
      'X-Execution-Mode': 'async',
    }
  )
}

function createBoundCopilotExecutionRequest(overrides: Record<string, unknown> = {}): NextRequest {
  return createMockRequest(
    'POST',
    {
      input: { hello: 'world' },
      stream: true,
      isClientSession: true,
      triggerType: 'copilot',
      copilotToolCallId: 'copilot-tool-1',
      ...overrides,
    },
    {
      'Content-Type': 'application/json',
      Cookie: 'session=value',
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
  afterAll(() => {
    resetEnvMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
    mockGenerateId.mockReset().mockReturnValue('execution-123')
    mockClaimExecutionId.mockImplementation(async (executionId: string) => ({
      key: `workflow-execution-id:${executionId}`,
      token: `token-${executionId}`,
    }))
    mockClaimWorkflowToolExecution.mockResolvedValue({
      toolCallId: 'copilot-tool-1',
      claimedBy: 'workflow:execution-123',
    })
    mockHasDurableExecutionOwner.mockResolvedValue(false)
    mockGetAsyncToolCall.mockReset().mockResolvedValue({
      toolCallId: 'copilot-tool-1',
      runId: 'copilot-run-1',
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
      status: 'running',
    })
    mockGetRunSegment.mockReset().mockResolvedValue({
      id: 'copilot-run-1',
      userId: 'session-user-1',
      workflowId: 'workflow-1',
    })

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
    mockExecuteWorkflowCore.mockReset().mockResolvedValue({
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
    mockInitializeExecutionStreamMeta.mockReset().mockResolvedValue(true)
    mockSetExecutionMeta.mockReset().mockResolvedValue(true)
    mockFlushExecutionStreamReplayBuffer.mockReset().mockResolvedValue(true)
    mockCreateExecutionEventWriter.mockReset().mockReturnValue({
      write: vi.fn(async (event: unknown) => ({ event, eventId: '1' })),
      writeTerminal: vi.fn(async (event: unknown) => ({ event, eventId: '2' })),
      close: vi.fn().mockResolvedValue(undefined),
    })
    loggingSessionMockFns.mockWaitForPostExecution.mockReset().mockResolvedValue(undefined)
  })

  it('binds a Copilot workflow tool only to its server log and waits before terminal SSE', async () => {
    let releasePostExecution: (() => void) | undefined
    loggingSessionMockFns.mockWaitForPostExecution.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releasePostExecution = resolve
        })
    )

    const response = await POST(createBoundCopilotExecutionRequest(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })
    const bodyPromise = response.text()

    await vi.waitFor(() => {
      expect(loggingSessionMockFns.mockWaitForPostExecution).toHaveBeenCalledTimes(1)
    })
    let streamCompleted = false
    void bodyPromise.then(() => {
      streamCompleted = true
    })
    await Promise.resolve()

    expect(response.status).toBe(200)
    expect(streamCompleted).toBe(false)
    expect(mockClaimWorkflowToolExecution).toHaveBeenCalledWith('copilot-tool-1', 'execution-123')
    expect(mockReleaseWorkflowToolExecutionClaim).not.toHaveBeenCalled()
    expect(loggingSessionMockFns.mockSetTrustedExecutionCorrelation).toHaveBeenCalledWith({
      executionId: 'execution-123',
      requestId: 'req-12345678',
      source: 'workflow',
      workflowId: 'workflow-1',
      triggerType: 'copilot',
      copilotToolCallId: 'copilot-tool-1',
    })
    const executionArgs = mockExecuteWorkflowCore.mock.calls[0][0]
    expect(executionArgs).not.toHaveProperty('copilotToolCallId')
    expect(executionArgs.snapshot.metadata).not.toHaveProperty('copilotToolCallId')

    releasePostExecution?.()
    const body = await bodyPromise
    expect(body).toContain('execution:completed')
  })

  /**
   * A terminal event the replay buffer rejected leaves the stream meta on
   * `active`, so a reconnecting reader polls until its deadline and then errors.
   * Recording the status directly is the only signal it gets.
   */
  it('records terminal stream meta when the replay buffer rejects the terminal event', async () => {
    mockCreateExecutionEventWriter.mockReturnValue({
      write: vi.fn(async (event: unknown) => ({ event, eventId: '1' })),
      writeTerminal: vi.fn(async () => {
        throw new Error('Execution memory limit exceeded. Reduce payload size and try again.')
      }),
      close: vi.fn().mockResolvedValue(undefined),
    })

    const response = await POST(createBoundCopilotExecutionRequest(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    // The live client still receives the terminal event over SSE.
    expect(body).toContain('execution:completed')
    expect(mockSetExecutionMeta).toHaveBeenCalledWith('execution-123', { status: 'complete' })
  })

  it('rejects a competing Copilot workflow execution before logging starts', async () => {
    mockClaimWorkflowToolExecution.mockResolvedValueOnce(null)

    const response = await POST(createBoundCopilotExecutionRequest(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Copilot workflow tool is already bound to another execution',
    })
    expect(loggingSessionMockFns.mockSetTrustedExecutionCorrelation).not.toHaveBeenCalled()
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
    expect(mockReleaseWorkflowToolExecutionClaim).not.toHaveBeenCalled()
    expect(mockReleaseExecutionIdClaim).toHaveBeenCalled()
  })

  it('releases a bound Copilot workflow claim when preprocessing rejects the run', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message: 'Not admitted', statusCode: 402 },
    })

    const response = await POST(createBoundCopilotExecutionRequest(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(402)
    expect(mockReleaseWorkflowToolExecutionClaim).toHaveBeenCalledWith(
      'copilot-tool-1',
      'execution-123'
    )
    expect(mockReleaseExecutionIdClaim).toHaveBeenCalled()
  })

  it('retains a bound Copilot workflow claim when preprocessing created a durable error log', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message: 'Not admitted', statusCode: 402 },
    })
    mockHasDurableExecutionOwner.mockResolvedValueOnce(true)

    const response = await POST(createBoundCopilotExecutionRequest(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(402)
    expect(mockReleaseWorkflowToolExecutionClaim).not.toHaveBeenCalled()
    expect(mockReleaseExecutionIdClaim).not.toHaveBeenCalled()
  })

  it('binds a workflow execution after its page-hide confirmation detached the waiter', async () => {
    mockGetAsyncToolCall.mockResolvedValueOnce({
      toolCallId: 'copilot-tool-1',
      runId: 'copilot-run-1',
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
      status: 'delivered',
      claimedBy: null,
    })

    const response = await POST(createBoundCopilotExecutionRequest(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(200)
    await response.text()
    expect(mockClaimWorkflowToolExecution).toHaveBeenCalledWith('copilot-tool-1', 'execution-123')
  })

  it('binds an approved pending workflow call created by the previous release', async () => {
    mockGetAsyncToolCall.mockResolvedValueOnce({
      toolCallId: 'copilot-tool-1',
      runId: 'copilot-run-1',
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
      status: 'pending',
      permissionDecision: 'allow',
      claimedBy: null,
    })

    const response = await POST(createBoundCopilotExecutionRequest(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(200)
    await response.text()
    expect(mockClaimWorkflowToolExecution).toHaveBeenCalledWith('copilot-tool-1', 'execution-123')
  })

  it.each([
    [
      'pending tool row',
      {
        toolCallId: 'copilot-tool-1',
        runId: 'copilot-run-1',
        toolName: 'run_workflow',
        args: { workflowId: 'workflow-1' },
        status: 'pending',
      },
      { id: 'copilot-run-1', userId: 'session-user-1', workflowId: 'workflow-1' },
    ],
    [
      'terminal tool row',
      {
        toolCallId: 'copilot-tool-1',
        runId: 'copilot-run-1',
        toolName: 'run_workflow',
        args: { workflowId: 'workflow-1' },
        status: 'completed',
      },
      { id: 'copilot-run-1', userId: 'session-user-1', workflowId: 'workflow-1' },
    ],
    [
      'different workflow target',
      {
        toolCallId: 'copilot-tool-1',
        runId: 'copilot-run-1',
        toolName: 'run_workflow',
        args: { workflowId: 'workflow-2' },
        status: 'running',
      },
      { id: 'copilot-run-1', userId: 'session-user-1', workflowId: 'workflow-1' },
    ],
    [
      'different execution actor',
      {
        toolCallId: 'copilot-tool-1',
        runId: 'copilot-run-1',
        toolName: 'run_workflow',
        args: { workflowId: 'workflow-1' },
        status: 'running',
      },
      { id: 'copilot-run-1', userId: 'other-user', workflowId: 'workflow-1' },
    ],
  ])('rejects a Copilot binding owned by a %s', async (_caseName, toolCall, run) => {
    mockGetAsyncToolCall.mockResolvedValueOnce(toolCall)
    mockGetRunSegment.mockResolvedValueOnce(run)

    const response = await POST(createBoundCopilotExecutionRequest(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(403)
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
    expect(loggingSessionMockFns.mockSetTrustedExecutionCorrelation).not.toHaveBeenCalled()
  })

  it('rejects Copilot workflow bindings outside the interactive SSE surface', async () => {
    const response = await POST(createBoundCopilotExecutionRequest({ stream: false }), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(400)
    expect(mockGetAsyncToolCall).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
  })

  it.each([
    [
      'cancelled',
      {
        success: false,
        status: 'cancelled',
        output: {},
        logs: [],
        metadata: { duration: 1 },
      },
    ],
    ['error', new Error('execution failed')],
  ])('waits for bound post-execution work on %s terminal paths', async (_caseName, outcome) => {
    if (outcome instanceof Error) {
      mockExecuteWorkflowCore.mockRejectedValueOnce(outcome)
    } else {
      mockExecuteWorkflowCore.mockResolvedValueOnce(outcome)
    }

    const response = await POST(createBoundCopilotExecutionRequest(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })
    await response.text()

    expect(loggingSessionMockFns.mockWaitForPostExecution).toHaveBeenCalledTimes(1)
  })

  it('reuses raw workflow input by execution ID without returning it to the client', async () => {
    const sourceInput = { token: 'raw-secret-1234', nested: { value: 42 } }
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'source-execution',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionData: { workflowInput: sourceInput },
      },
    ])
    const request = createMockRequest(
      'POST',
      { inputFromExecutionId: 'source-execution' },
      {
        'Content-Type': 'application/json',
        'X-Execution-Mode': 'async',
        Cookie: 'session=value',
      }
    )

    const response = await POST(request, { params: Promise.resolve({ id: 'workflow-1' }) })
    const responseBody = await response.json()

    expect(response.status).toBe(202)
    expect(responseBody).not.toHaveProperty('input')
    expect(JSON.stringify(responseBody)).not.toContain('raw-secret-1234')
    expect(mockEnqueue).toHaveBeenCalledWith(
      'workflow-execution',
      expect.objectContaining({ input: sourceInput }),
      expect.any(Object)
    )
  })

  it('recovers legacy starter input by execution ID without returning it to the client', async () => {
    const sourceInput = { token: 'legacy-retry-input', nested: { value: 42 } }
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'source-execution',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionData: {
          executionState: {
            blockStates: {
              start: {
                output: sourceInput,
                executed: false,
                executionTime: 0,
              },
            },
          },
        },
      },
    ])
    const request = createMockRequest(
      'POST',
      { inputFromExecutionId: 'source-execution' },
      {
        'Content-Type': 'application/json',
        'X-Execution-Mode': 'async',
        Cookie: 'session=value',
      }
    )

    const response = await POST(request, { params: Promise.resolve({ id: 'workflow-1' }) })
    const responseBody = await response.json()

    expect(response.status).toBe(202)
    expect(responseBody).not.toHaveProperty('input')
    expect(JSON.stringify(responseBody)).not.toContain('legacy-retry-input')
    expect(mockEnqueue).toHaveBeenCalledWith(
      'workflow-execution',
      expect.objectContaining({ input: sourceInput }),
      expect.any(Object)
    )
  })

  it('rejects client input alongside a stored execution input reference', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          input: { replacement: true },
          inputFromExecutionId: 'source-execution',
        },
        { 'Content-Type': 'application/json', Cookie: 'session=value' }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Provide either input or inputFromExecutionId, not both',
    })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('rejects stored execution input references from external callers', async () => {
    mockCheckHybridAuth.mockResolvedValue({
      success: true,
      userId: 'personal-key-user-1',
      authType: 'api_key',
      apiKeyType: 'personal',
    })
    const response = await POST(
      createMockRequest(
        'POST',
        { inputFromExecutionId: 'source-execution' },
        { 'Content-Type': 'application/json', 'X-API-Key': 'personal-key' }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Stored execution input can only be reused by an authenticated session',
    })
    expect(mockEnqueue).not.toHaveBeenCalled()
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

  it('loads trusted run-from-block state by execution ID and preserves its source identity', async () => {
    const sourceState = {
      blockStates: { previous: { output: { value: 'cached' } } },
      executedBlocks: ['previous'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
      resolvedSecretTraceProvenance: {
        version: 1,
        complete: true,
        entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
        scope: { userId: 'owner-1', workspaceId: 'workspace-1' },
      },
    }
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'source-execution',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionData: { executionState: sourceState },
      },
    ])
    const request = createMockRequest(
      'POST',
      {
        input: { hello: 'world' },
        runFromBlock: {
          startBlockId: 'start-block',
          executionId: 'source-execution',
        },
      },
      {
        'Content-Type': 'application/json',
        Cookie: 'session=value',
      }
    )

    const response = await POST(request, { params: Promise.resolve({ id: 'workflow-1' }) })

    expect(response.status).toBe(200)
    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        runFromBlock: {
          startBlockId: 'start-block',
          sourceSnapshot: sourceState,
          sourceExecutionId: 'source-execution',
        },
      })
    )
  })

  it('falls back to an untrusted client snapshot while stored run-from-block state is pending', async () => {
    const sourceSnapshot = {
      blockStates: { previous: { output: { value: 'cached' } } },
      executedBlocks: ['previous'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
      resolvedSecretTraceProvenance: {
        version: 1,
        complete: true,
        entries: [{ name: 'TOKEN', encryptedValue: 'untrusted-ciphertext' }],
      },
    }
    queueTableRows(schemaMock.workflowExecutionLogs, [])
    const request = createMockRequest(
      'POST',
      {
        input: { hello: 'world' },
        runFromBlock: {
          startBlockId: 'start-block',
          executionId: 'source-execution',
          sourceSnapshot,
        },
      },
      {
        'Content-Type': 'application/json',
        Cookie: 'session=value',
      }
    )

    const response = await POST(request, { params: Promise.resolve({ id: 'workflow-1' }) })

    expect(response.status).toBe(200)
    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        runFromBlock: {
          startBlockId: 'start-block',
          sourceSnapshot: expect.objectContaining({
            blockStates: sourceSnapshot.blockStates,
            executedBlocks: sourceSnapshot.executedBlocks,
          }),
        },
      })
    )
    const runFromBlock = mockExecuteWorkflowCore.mock.calls[0]?.[0]?.runFromBlock
    expect(runFromBlock).not.toHaveProperty('sourceExecutionId')
    expect(runFromBlock?.sourceSnapshot).not.toHaveProperty('resolvedSecretTraceProvenance')
  })

  it('returns encrypted resolution provenance only to an authenticated internal tool caller', async () => {
    const caller = EXECUTION_CALLERS[4]
    configureExecutionCaller(caller)
    const provenance = {
      version: 1,
      complete: true,
      entries: [{ name: 'CHILD_SECRET', encryptedValue: 'encrypted-child-secret' }],
    }
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: { ok: true },
      executionState: { resolvedSecretTraceProvenance: provenance },
      metadata: {
        duration: 100,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
      },
    })
    const request = createCallerExecutionRequest(caller, undefined, 'sync')
    request.headers.set('x-sim-request-private-tool-metadata', 'resolved-secret-provenance-v1')

    const response = await POST(request, { params: Promise.resolve({ id: 'workflow-1' }) })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    await expect(response.json()).resolves.toMatchObject({
      output: { ok: true },
      __resolvedSecretTraceProvenance: provenance,
    })
  })

  it('does not expose private provenance metadata to non-internal callers', async () => {
    const caller = EXECUTION_CALLERS[1]
    configureExecutionCaller(caller)
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: { ok: true },
      executionState: {
        resolvedSecretTraceProvenance: {
          version: 1,
          complete: true,
          entries: [{ name: 'SECRET', encryptedValue: 'encrypted-secret' }],
        },
      },
      metadata: {
        duration: 100,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
      },
    })
    const request = createCallerExecutionRequest(caller, undefined, 'sync')
    request.headers.set('x-sim-request-private-tool-metadata', 'resolved-secret-provenance-v1')

    const response = await POST(request, { params: Promise.resolve({ id: 'workflow-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-sim-private-tool-metadata')).toBeNull()
    expect(body).not.toHaveProperty('__resolvedSecretTraceProvenance')
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
