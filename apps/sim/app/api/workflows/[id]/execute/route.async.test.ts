/**
 * @vitest-environment node
 */

import {
  createMockRequest,
  dbChainMockFns,
  encryptionMock,
  encryptionMockFns,
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
import { getRemainingExecutionMs } from '@/lib/core/execution-limits'
import { INTERNAL_EXECUTION_DEADLINE_HEADER } from '@/lib/execution/execution-deadline-header'
import { WORKFLOW_NOT_DEPLOYED_CODE } from '@/lib/execution/preprocessing'
import {
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
} from '@/lib/execution/private-tool-metadata'

const {
  mockAssertBillingAttributionSnapshot,
  mockClaimExecutionId,
  mockClaimWorkflowToolExecution,
  mockCheckNeedsRedeployment,
  mockEnqueue,
  mockExecuteWorkflowJob,
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
  mockMarkExecutionStreamTerminal,
  mockSetExecutionActiveBlockStarts,
  mockReleaseExecutionIdClaim,
  mockReleaseExecutionSlot,
  mockReleaseWorkflowToolExecutionClaim,
  mockRequireBillingAttributionHeader,
  mockShouldExecuteInline,
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
  mockCheckNeedsRedeployment: vi.fn(),
  mockEnqueue: vi.fn().mockResolvedValue('job-123'),
  mockExecuteWorkflowJob: vi.fn(),
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
  mockMarkExecutionStreamTerminal: vi.fn(),
  mockSetExecutionActiveBlockStarts: vi.fn(),
  mockReleaseExecutionIdClaim: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockReleaseWorkflowToolExecutionClaim: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockShouldExecuteInline: vi.fn().mockReturnValue(false),
  mockValidatePublicApiAllowed: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: mockAssertBillingAttributionSnapshot,
  requireBillingAttributionHeader: mockRequireBillingAttributionHeader,
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

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

vi.mock('@/lib/workflows/deployment-status', () => ({
  checkNeedsRedeployment: mockCheckNeedsRedeployment,
}))

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
  markExecutionStreamTerminal: mockMarkExecutionStreamTerminal,
  setExecutionActiveBlockStarts: mockSetExecutionActiveBlockStarts,
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
  }),
  shouldExecuteInline: mockShouldExecuteInline,
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

import { PERSONAL_KEY_DENIED, WORKSPACE_KEY_SCOPE_DENIED } from '@/lib/api-key/policy-messages'
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

const SESSION_PRINCIPAL = {
  kind: 'session',
  userId: 'session-user-1',
  sessionId: 'session-1',
} as const

const PERSONAL_API_KEY_PRINCIPAL = {
  kind: 'personal_api_key',
  userId: 'personal-key-user-1',
  keyId: 'personal-key-1',
} as const

const WORKSPACE_API_KEY_PRINCIPAL = {
  kind: 'workspace_api_key',
  workspaceId: 'workspace-1',
  keyId: 'workspace-key-1',
} as const

const EXECUTION_CALLERS: ExecutionCallerCase[] = [
  {
    caseName: 'session',
    authResult: {
      success: true,
      userId: 'session-user-1',
      authType: 'session',
      principal: SESSION_PRINCIPAL,
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
      principal: PERSONAL_API_KEY_PRINCIPAL,
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
      principal: WORKSPACE_API_KEY_PRINCIPAL,
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
  executionMode: 'async' | 'sync' = 'async',
  additionalHeaders: Record<string, string> = {}
): NextRequest {
  const input = { hello: 'world' }
  const body = caller.usesExternalInput
    ? { ...input, ...(executionId ? { executionId } : {}) }
    : { input, ...(executionId ? { executionId } : {}) }

  return createMockRequest('POST', body, {
    'Content-Type': 'application/json',
    ...(executionMode === 'async' ? { 'X-Execution-Mode': 'async' } : {}),
    ...caller.headers,
    ...additionalHeaders,
  })
}

const WORKFLOW_INPUT_PROVENANCE = {
  version: 1 as const,
  complete: true,
  entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
  scope: { userId: 'parent-owner', workspaceId: 'workspace-1' },
}

function createInternalProvenanceRequest(
  options: {
    executionMode?: 'async' | 'sync'
    stream?: boolean
    useDraftState?: boolean
    provenance?: typeof WORKFLOW_INPUT_PROVENANCE
    selectionKey?: string
    bundleComplete?: boolean
    includeHeader?: boolean
    includeField?: boolean
  } = {}
): NextRequest {
  const caller = EXECUTION_CALLERS[4]
  const {
    executionMode = 'sync',
    stream,
    useDraftState,
    provenance = WORKFLOW_INPUT_PROVENANCE,
    selectionKey = 'input',
    bundleComplete = true,
    includeHeader = true,
    includeField = true,
  } = options

  return createMockRequest(
    'POST',
    {
      input: { token: 'secret-value' },
      triggerType: 'workflow',
      parentWorkspaceId: 'workspace-1',
      ...(stream !== undefined ? { stream } : {}),
      ...(useDraftState !== undefined ? { useDraftState } : {}),
      ...(includeField
        ? {
            [PRIVATE_SECRET_PROVENANCE_FIELD]: {
              version: 1,
              complete: bundleComplete,
              selections: bundleComplete ? [{ key: selectionKey, provenance }] : [],
            },
          }
        : {}),
    },
    {
      'Content-Type': 'application/json',
      ...(executionMode === 'async' ? { 'X-Execution-Mode': 'async' } : {}),
      ...caller.headers,
      ...(includeHeader
        ? { [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1 }
        : {}),
    }
  )
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
    mockCheckNeedsRedeployment.mockResolvedValue(false)
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
    mockShouldExecuteInline.mockReturnValue(false)
    mockValidatePublicApiAllowed.mockResolvedValue(undefined)

    mockCheckHybridAuth.mockResolvedValue({
      success: true,
      userId: 'session-user-1',
      authType: 'session',
      principal: SESSION_PRINCIPAL,
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
      executionTimeout: { sync: 300_000, async: 5_400_000 },
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
    mockMarkExecutionStreamTerminal.mockReset().mockResolvedValue(true)
    mockSetExecutionActiveBlockStarts.mockReset().mockResolvedValue(true)
    mockFlushExecutionStreamReplayBuffer.mockReset().mockResolvedValue(true)
    mockCreateExecutionEventWriter.mockReset().mockReturnValue({
      write: vi.fn(async (event: unknown) => ({ event, eventId: '1' })),
      writeTerminal: vi.fn(async (event: unknown) => ({ event, eventId: '2' })),
      flush: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    })
    loggingSessionMockFns.mockWaitForPostExecution.mockReset().mockResolvedValue(undefined)
    loggingSessionMockFns.mockExportResolvedSecretTraceProvenanceForValue
      .mockReset()
      .mockReturnValue({ version: 1, complete: false, entries: [] })
    mockExecuteWorkflowJob.mockReset().mockResolvedValue({ success: true })
    encryptionMockFns.mockDecryptSecret.mockReset().mockImplementation(async (value: string) => ({
      decrypted: value === 'encrypted-token' ? 'secret-value' : 'other-secret',
    }))
  })

  it('imports authenticated workflow input provenance into synchronous execution', async () => {
    configureExecutionCaller(EXECUTION_CALLERS[4])

    const response = await POST(createInternalProvenanceRequest(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(200)
    const executionOptions = mockExecuteWorkflowCore.mock.calls[0]?.[0]
    expect(executionOptions).toMatchObject({
      trustedInitialResolvedSecretTraceProvenance: WORKFLOW_INPUT_PROVENANCE,
    })
    expect(executionOptions.snapshot.input).toEqual({ input: { token: 'secret-value' } })
    expect(executionOptions.snapshot.input).not.toHaveProperty(PRIVATE_SECRET_PROVENANCE_FIELD)
  })

  it('preserves headerless legacy internal workflow execution', async () => {
    const caller = EXECUTION_CALLERS[4]
    configureExecutionCaller(caller)

    const response = await POST(createCallerExecutionRequest(caller, undefined, 'sync'), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(200)
    const executionOptions = mockExecuteWorkflowCore.mock.calls[0]?.[0]
    expect(executionOptions.trustedInitialResolvedSecretTraceProvenance).toBeUndefined()
    expect(executionOptions.snapshot.input).toEqual({ hello: 'world' })
  })

  it('runs authenticated incomplete workflow input with incomplete downstream lineage', async () => {
    configureExecutionCaller(EXECUTION_CALLERS[4])

    const response = await POST(createInternalProvenanceRequest({ bundleComplete: false }), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(200)
    const executionOptions = mockExecuteWorkflowCore.mock.calls[0]?.[0]
    expect(executionOptions).toMatchObject({
      trustedInitialResolvedSecretTraceProvenance: {
        version: 1,
        complete: false,
        entries: [],
      },
    })
    expect(executionOptions.snapshot.input).toEqual({ input: { token: 'secret-value' } })
    expect(executionOptions.snapshot.input).not.toHaveProperty(PRIVATE_SECRET_PROVENANCE_FIELD)
  })

  it.each([
    { name: 'standard stream', useDraftState: false },
    { name: 'manual event stream', useDraftState: true },
  ])(
    'imports authenticated workflow input provenance into $name execution',
    async ({ useDraftState }) => {
      configureExecutionCaller(EXECUTION_CALLERS[4])

      const response = await POST(
        createInternalProvenanceRequest({ stream: true, useDraftState }),
        { params: Promise.resolve({ id: 'workflow-1' }) }
      )
      await response.text()

      expect(response.status).toBe(200)
      const executionOptions = mockExecuteWorkflowCore.mock.calls[0]?.[0]
      expect(executionOptions).toMatchObject({
        trustedInitialResolvedSecretTraceProvenance: WORKFLOW_INPUT_PROVENANCE,
      })
      expect(executionOptions.snapshot.input).toEqual({ input: { token: 'secret-value' } })
      expect(executionOptions.snapshot.input).not.toHaveProperty(PRIVATE_SECRET_PROVENANCE_FIELD)
    }
  )

  it('queues authenticated workflow input provenance without exposing the private sidecar as input', async () => {
    configureExecutionCaller(EXECUTION_CALLERS[4])

    const response = await POST(createInternalProvenanceRequest({ executionMode: 'async' }), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(202)
    const payload = mockEnqueue.mock.calls[0]?.[1]
    expect(payload).toMatchObject({
      input: { input: { token: 'secret-value' } },
      trustedInitialResolvedSecretTraceProvenance: WORKFLOW_INPUT_PROVENANCE,
    })
    expect(payload.input).not.toHaveProperty(PRIVATE_SECRET_PROVENANCE_FIELD)
  })

  it.each([
    {
      name: 'missing sidecar',
      request: () => createInternalProvenanceRequest({ includeField: false }),
      caller: EXECUTION_CALLERS[4],
    },
    {
      name: 'missing marker',
      request: () => createInternalProvenanceRequest({ includeHeader: false }),
      caller: EXECUTION_CALLERS[4],
    },
    {
      name: 'wrong workspace',
      request: () =>
        createInternalProvenanceRequest({
          provenance: {
            ...WORKFLOW_INPUT_PROVENANCE,
            scope: { userId: 'parent-owner', workspaceId: 'workspace-2' },
          },
        }),
      caller: EXECUTION_CALLERS[4],
    },
    {
      name: 'non-internal caller',
      request: () => createInternalProvenanceRequest(),
      caller: EXECUTION_CALLERS[1],
    },
  ])('rejects $name provenance before preprocessing', async ({ request, caller }) => {
    configureExecutionCaller(caller)

    const response = await POST(request(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid workflow input secret provenance',
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
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

  it('executes a selected trigger as a fresh authenticated draft run', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          stream: true,
          input: { message: 'hello' },
          startBlockId: 'start',
          triggerType: 'manual',
          useDraftState: true,
          isClientSession: true,
        },
        {
          'Content-Type': 'application/json',
          Cookie: 'session=value',
        }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )
    await response.text()

    expect(response.status).toBe(200)
    expect(mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      userId: 'session-user-1',
      action: 'write',
    })
    const executionArgs = mockExecuteWorkflowCore.mock.calls[0][0]
    expect(executionArgs.runFromBlock).toBeUndefined()
    expect(executionArgs.snapshot.metadata).toMatchObject({
      triggerType: 'manual',
      triggerBlockId: 'start',
      useDraftState: true,
      isClientSession: true,
      sessionUserId: 'session-user-1',
    })
  })

  it('keeps a manual execution alive when its browser SSE observer detaches', async () => {
    let capturedSignal: AbortSignal | undefined
    let resolveStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    let resolveExecution: (() => void) | undefined
    mockExecuteWorkflowCore.mockImplementationOnce(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((resolve) => {
          capturedSignal = abortSignal
          resolveStarted?.()
          resolveExecution = () =>
            resolve({
              success: true,
              status: 'completed',
              output: { ok: true },
              metadata: {
                duration: 100,
                startTime: '2026-01-01T00:00:00Z',
                endTime: '2026-01-01T00:00:01Z',
              },
            })
        })
    )

    const response = await POST(
      createMockRequest(
        'POST',
        {
          stream: true,
          input: { message: 'hello' },
          triggerType: 'manual',
          isClientSession: true,
        },
        {
          'Content-Type': 'application/json',
          Cookie: 'session=value',
        }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )
    await started

    const detach = response.body?.cancel()
    await Promise.resolve()
    expect(capturedSignal?.aborted).toBe(false)

    resolveExecution?.()
    await detach
    expect(capturedSignal?.aborted).toBe(false)
  })

  it('fails the observer closed when an active-block snapshot cannot be persisted', async () => {
    mockSetExecutionActiveBlockStarts.mockResolvedValueOnce(false)
    mockExecuteWorkflowCore.mockImplementationOnce(async ({ callbacks, abortSignal }) => {
      try {
        await callbacks.onBlockStart('function-1', 'Function', 'function', 1)
      } finally {
        expect(abortSignal.aborted).toBe(true)
      }
      throw new Error('workflow should stop after the lifecycle persistence failure')
    })

    const response = await POST(
      createMockRequest(
        'POST',
        {
          stream: true,
          input: { message: 'hello' },
          triggerType: 'manual',
          isClientSession: true,
        },
        {
          'Content-Type': 'application/json',
          Cookie: 'session=value',
        }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    await expect(response.text()).rejects.toThrow('Failed to persist active execution snapshot')
    await vi.waitFor(() => {
      expect(mockMarkExecutionStreamTerminal).toHaveBeenCalledWith('execution-123', 'error')
    })
  })

  it('serializes parallel lifecycle events before sending them to the observer', async () => {
    let releaseFirstSnapshot!: () => void
    const firstSnapshotReleased = new Promise<void>((resolve) => {
      releaseFirstSnapshot = resolve
    })
    let firstSnapshotStarted!: () => void
    const firstSnapshotPending = new Promise<void>((resolve) => {
      firstSnapshotStarted = resolve
    })
    let snapshotCalls = 0
    mockSetExecutionActiveBlockStarts.mockImplementation(async () => {
      snapshotCalls += 1
      if (snapshotCalls === 1) {
        firstSnapshotStarted()
        await firstSnapshotReleased
      }
      return true
    })
    let eventId = 0
    mockCreateExecutionEventWriter.mockReturnValue({
      write: vi.fn(async (event: unknown) => ({ event, eventId: String(++eventId) })),
      writeTerminal: vi.fn(async (event: unknown) => ({ event, eventId: String(++eventId) })),
      flush: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    })
    mockExecuteWorkflowCore.mockImplementationOnce(async ({ callbacks }) => {
      const first = callbacks.onBlockStart('function-a', 'Function A', 'function', 1)
      const second = callbacks.onBlockStart('function-b', 'Function B', 'function', 2)
      await Promise.all([first, second])
      return {
        success: true,
        status: 'completed',
        output: { ok: true },
        metadata: {
          duration: 100,
          startTime: '2026-01-01T00:00:00Z',
          endTime: '2026-01-01T00:00:01Z',
        },
      }
    })

    const response = await POST(
      createMockRequest(
        'POST',
        {
          stream: true,
          input: { message: 'hello' },
          triggerType: 'manual',
          isClientSession: true,
        },
        {
          'Content-Type': 'application/json',
          Cookie: 'session=value',
        }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )
    await firstSnapshotPending
    releaseFirstSnapshot()
    const body = await response.text()

    expect(body.indexOf('function-a')).toBeGreaterThan(-1)
    expect(body.indexOf('function-b')).toBeGreaterThan(body.indexOf('function-a'))
    expect(mockSetExecutionActiveBlockStarts).toHaveBeenNthCalledWith(
      2,
      'execution-123',
      expect.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ blockId: 'function-a' }) }),
        expect.objectContaining({ data: expect.objectContaining({ blockId: 'function-b' }) }),
      ])
    )
  })

  /**
   * A terminal event the replay buffer rejected leaves no terminal event for a reconnecting reader.
   * Recording terminal metadata lets the pushed wake close the observer instead of leaving it active.
   */
  it('records terminal stream meta when the replay buffer rejects the terminal event', async () => {
    mockCreateExecutionEventWriter.mockReturnValue({
      write: vi.fn(async (event: unknown) => ({ event, eventId: '1' })),
      writeTerminal: vi.fn(async () => {
        throw new Error('Execution memory limit exceeded. Reduce payload size and try again.')
      }),
      flush: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    })

    const response = await POST(createBoundCopilotExecutionRequest(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.text()).rejects.toThrow(
      'Execution memory limit exceeded. Reduce payload size and try again.'
    )
    expect(mockMarkExecutionStreamTerminal).toHaveBeenCalledWith('execution-123', 'error')
  })

  it('rejects a competing Copilot workflow execution before logging starts', async () => {
    mockClaimWorkflowToolExecution.mockResolvedValueOnce(null)

    const response = await POST(createBoundCopilotExecutionRequest(), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Copilot workflow tool is already bound to another execution',
      code: 'COPILOT_WORKFLOW_EXECUTION_CONFLICT',
    })
    expect(mockGetAsyncToolCall).toHaveBeenCalledTimes(1)
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
      403,
      'COPILOT_WORKFLOW_TOOL_BINDING_AWAITING_APPROVAL',
    ],
    [
      // A finished call is a benign duplicate, not a defect: some other runner
      // already owns this tool call, so it reports the same conflict the
      // execution claim does and the client stays silent.
      'terminal tool row',
      {
        toolCallId: 'copilot-tool-1',
        runId: 'copilot-run-1',
        toolName: 'run_workflow',
        args: { workflowId: 'workflow-1' },
        status: 'completed',
      },
      { id: 'copilot-run-1', userId: 'session-user-1', workflowId: 'workflow-1' },
      409,
      'COPILOT_WORKFLOW_EXECUTION_CONFLICT',
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
      403,
      'COPILOT_WORKFLOW_TOOL_BINDING_WORKFLOW_MISMATCH',
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
      403,
      'COPILOT_WORKFLOW_TOOL_BINDING_FOREIGN_OWNER',
    ],
    ['missing tool row', null, null, 404, 'COPILOT_WORKFLOW_TOOL_BINDING_UNKNOWN'],
  ])(
    'rejects a Copilot binding owned by a %s',
    async (_caseName, toolCall, run, expectedStatus, expectedCode) => {
      mockGetAsyncToolCall.mockResolvedValueOnce(toolCall)
      mockGetRunSegment.mockResolvedValueOnce(run)

      const response = await POST(createBoundCopilotExecutionRequest(), {
        params: Promise.resolve({ id: 'workflow-1' }),
      })

      expect(response.status).toBe(expectedStatus)
      // The reason must be machine-readable — an opaque 403 is what stopped the
      // client telling a benign duplicate from a real failure.
      await expect(response.json()).resolves.toMatchObject({ code: expectedCode })
      expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
      expect(loggingSessionMockFns.mockSetTrustedExecutionCorrelation).not.toHaveBeenCalled()
    }
  )

  it('rejects Copilot workflow bindings outside the interactive SSE surface', async () => {
    const response = await POST(createBoundCopilotExecutionRequest({ stream: false }), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(400)
    expect(mockGetAsyncToolCall).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
  })

  it('queues a bound Copilot workflow execution asynchronously', async () => {
    const request = createBoundCopilotExecutionRequest({
      stream: false,
      triggerBlockId: 'trigger-async',
    })
    request.headers.set('X-Execution-Mode', 'async')

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(202)
    expect(mockClaimWorkflowToolExecution).toHaveBeenCalledWith('copilot-tool-1', 'execution-123')
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ checkDeployment: true, executionType: 'async' })
    )
    expect(loggingSessionMockFns.mockSetTrustedExecutionCorrelation).toHaveBeenCalledWith({
      executionId: 'execution-123',
      requestId: 'req-12345678',
      source: 'workflow',
      workflowId: 'workflow-1',
      triggerType: 'copilot',
      copilotToolCallId: 'copilot-tool-1',
    })
    expect(mockEnqueue).toHaveBeenCalledWith(
      'workflow-execution',
      expect.objectContaining({
        executionId: 'execution-123',
        triggerBlockId: 'trigger-async',
        correlation: expect.objectContaining({ copilotToolCallId: 'copilot-tool-1' }),
      }),
      expect.any(Object)
    )
  })

  it('rejects a bound async run when the deployed workflow is stale', async () => {
    mockCheckNeedsRedeployment.mockResolvedValueOnce(true)
    const request = createBoundCopilotExecutionRequest({ stream: false })
    request.headers.set('X-Execution-Mode', 'async')

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Async execution requires the current workflow to match its deployed version',
      code: 'ASYNC_WORKFLOW_DEPLOYMENT_STALE',
    })
    expect(mockClaimWorkflowToolExecution).toHaveBeenCalledWith('copilot-tool-1', 'execution-123')
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-123')
    expect(mockReleaseWorkflowToolExecutionClaim).toHaveBeenCalledWith(
      'copilot-tool-1',
      'execution-123'
    )
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('rejects a bound async run when the workflow has not been deployed', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Workflow is not deployed',
        statusCode: 403,
        code: WORKFLOW_NOT_DEPLOYED_CODE,
      },
    })
    const request = createBoundCopilotExecutionRequest({ stream: false })
    request.headers.set('X-Execution-Mode', 'async')

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Async execution requires the workflow to be deployed first',
      code: 'ASYNC_WORKFLOW_DEPLOYMENT_MISSING',
    })
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-123')
    expect(mockReleaseWorkflowToolExecutionClaim).toHaveBeenCalledWith(
      'copilot-tool-1',
      'execution-123'
    )
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockCheckNeedsRedeployment).not.toHaveBeenCalled()
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
      principal: PERSONAL_API_KEY_PRINCIPAL,
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
    expect(body.statusUrl).toBe('http://localhost:3000/api/jobs/job-123')
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

  it('runs database-inline workflow jobs through the queue cancellation signal', async () => {
    mockShouldExecuteInline.mockReturnValue(true)
    const response = await POST(
      createMockRequest(
        'POST',
        { input: { hello: 'world' } },
        { 'Content-Type': 'application/json', 'X-Execution-Mode': 'async' }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )
    const options = mockEnqueue.mock.calls[0]?.[2] as {
      runner?: (payload: unknown, signal: AbortSignal) => Promise<unknown>
    }
    const controller = new AbortController()

    expect(response.status).toBe(202)
    expect(options.runner).toBeTypeOf('function')
    await options.runner?.({}, controller.signal)
    expect(mockExecuteWorkflowJob).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'execution-123', workflowId: 'workflow-1' }),
      controller.signal
    )
  })

  it('rejects the execution timeout header for a synchronous run', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        { input: { hello: 'world' } },
        {
          'Content-Type': 'application/json',
          'X-Execution-Timeout-Seconds': '60',
          Cookie: 'session=value',
        }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'X-Execution-Timeout-Seconds is supported only for async runs',
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('inherits a trusted parent deadline instead of applying the synchronous plan timeout', async () => {
    const caller = EXECUTION_CALLERS.find(({ caseName }) => caseName === 'internal JWT')!
    configureExecutionCaller(caller)
    const deadlineAt = Date.now() + 2 * 60 * 60_000
    let remainingExecutionMs: number | undefined
    mockExecuteWorkflowCore.mockImplementationOnce(
      async ({ abortSignal }: { abortSignal: AbortSignal }) => {
        remainingExecutionMs = getRemainingExecutionMs(abortSignal)
        return {
          success: true,
          status: 'completed',
          output: { ok: true },
          metadata: {
            duration: 100,
            startTime: '2026-01-01T00:00:00Z',
            endTime: '2026-01-01T00:00:01Z',
          },
        }
      }
    )

    const response = await POST(
      createCallerExecutionRequest(caller, undefined, 'sync', {
        [INTERNAL_EXECUTION_DEADLINE_HEADER]: String(deadlineAt),
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(200)
    expect(remainingExecutionMs).toBeGreaterThan(60 * 60_000)
    expect(remainingExecutionMs).toBeLessThanOrEqual(2 * 60 * 60_000)
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        executionType: 'sync',
        executionDeadlineAt: deadlineAt,
      })
    )
  })

  it('ignores the internal deadline header from an untrusted caller', async () => {
    const caller = EXECUTION_CALLERS.find(({ caseName }) => caseName === 'session')!
    configureExecutionCaller(caller)
    let remainingExecutionMs: number | undefined
    mockExecuteWorkflowCore.mockImplementationOnce(
      async ({ abortSignal }: { abortSignal: AbortSignal }) => {
        remainingExecutionMs = getRemainingExecutionMs(abortSignal)
        return {
          success: true,
          status: 'completed',
          output: { ok: true },
          metadata: {
            duration: 100,
            startTime: '2026-01-01T00:00:00Z',
            endTime: '2026-01-01T00:00:01Z',
          },
        }
      }
    )

    const response = await POST(
      createCallerExecutionRequest(caller, undefined, 'sync', {
        [INTERNAL_EXECUTION_DEADLINE_HEADER]: String(Date.now() + 2 * 60 * 60_000),
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(200)
    expect(remainingExecutionMs).toBeGreaterThan(4 * 60_000)
    expect(remainingExecutionMs).toBeLessThanOrEqual(5 * 60_000)
    expect(mockPreprocessExecution.mock.calls[0]?.[0]).not.toHaveProperty('executionDeadlineAt')
  })

  it('fails an already-expired trusted parent deadline as a timeout', async () => {
    const caller = EXECUTION_CALLERS.find(({ caseName }) => caseName === 'internal JWT')!
    configureExecutionCaller(caller)

    const response = await POST(
      createCallerExecutionRequest(caller, undefined, 'sync', {
        [INTERNAL_EXECUTION_DEADLINE_HEADER]: String(Date.now() - 1),
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(408)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Execution timed out',
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
  })

  it('classifies a parent disconnect at the inherited deadline as a timeout', async () => {
    const caller = EXECUTION_CALLERS.find(({ caseName }) => caseName === 'internal JWT')!
    configureExecutionCaller(caller)
    const requestController = new AbortController()
    const initialNow = Date.now()
    const deadlineAt = initialNow + 60_000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(initialNow)
    mockExecuteWorkflowCore.mockImplementationOnce(
      async ({ abortSignal }: { abortSignal: AbortSignal }) => {
        nowSpy.mockReturnValue(deadlineAt)
        requestController.abort(new DOMException('The operation was aborted.', 'AbortError'))
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
    const request = new NextRequest('http://localhost:3000/api/workflows/workflow-1/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...caller.headers,
        [INTERNAL_EXECUTION_DEADLINE_HEADER]: String(deadlineAt),
      },
      body: JSON.stringify({ hello: 'world' }),
      signal: requestController.signal,
    })

    try {
      const response = await POST(request, {
        params: Promise.resolve({ id: 'workflow-1' }),
      })

      expect(response.status).toBe(408)
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining('Execution timed out'),
      })
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('rejects a malformed trusted parent deadline instead of resetting the child budget', async () => {
    const caller = EXECUTION_CALLERS.find(({ caseName }) => caseName === 'internal JWT')!
    configureExecutionCaller(caller)

    const response = await POST(
      createCallerExecutionRequest(caller, undefined, 'sync', {
        [INTERNAL_EXECUTION_DEADLINE_HEADER]: 'not-a-deadline',
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid internal execution deadline header',
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
  })

  it('rejects an execution timeout above seven days', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        { input: { hello: 'world' } },
        {
          'Content-Type': 'application/json',
          'X-Execution-Mode': 'async',
          'X-Execution-Timeout-Seconds': '604801',
          Cookie: 'session=value',
        }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid execution timeout header',
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('queues the smaller request timeout resolved against account policy', async () => {
    mockPreprocessExecution.mockImplementationOnce(async (options) => ({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
      billingAttribution,
      executionTimeout: {
        sync: 300_000,
        async: Math.min(5_400_000, (options.requestedTimeoutSeconds ?? 5_400) * 1000),
      },
    }))

    const response = await POST(
      createMockRequest(
        'POST',
        { input: { hello: 'world' } },
        {
          'Content-Type': 'application/json',
          'X-Execution-Mode': 'async',
          'X-Execution-Timeout-Seconds': '60',
          Cookie: 'session=value',
        }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(202)
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ executionType: 'async', requestedTimeoutSeconds: 60 })
    )
    expect(mockEnqueue).toHaveBeenCalledWith(
      'workflow-execution',
      expect.objectContaining({ executionTimeoutMs: 60_000 }),
      expect.objectContaining({ maxDurationSeconds: 360 })
    )
  })

  it('never lets a request timeout extend the account policy', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        { input: { hello: 'world' } },
        {
          'Content-Type': 'application/json',
          'X-Execution-Mode': 'async',
          'X-Execution-Timeout-Seconds': '7200',
          Cookie: 'session=value',
        }
      ),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(202)
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ executionType: 'async', requestedTimeoutSeconds: 7_200 })
    )
    expect(mockEnqueue).toHaveBeenCalledWith(
      'workflow-execution',
      expect.objectContaining({ executionTimeoutMs: 5_400_000 }),
      expect.objectContaining({ maxDurationSeconds: 5_700 })
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
      error: WORKSPACE_KEY_SCOPE_DENIED,
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
      error: PERSONAL_KEY_DENIED,
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
    const workflowStateOverride = {
      blocks: {
        'start-block': {
          id: 'start-block',
          type: 'function',
          name: 'Function 1',
          position: { x: 0, y: 0 },
          subBlocks: {
            code: { id: 'code', type: 'code', value: 'return "current editor state"' },
          },
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    }
    const request = createMockRequest(
      'POST',
      {
        input: { hello: 'world' },
        useDraftState: true,
        isClientSession: true,
        workflowStateOverride,
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
    const executionArgs = mockExecuteWorkflowCore.mock.calls[0]?.[0]
    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        runFromBlock: {
          startBlockId: 'start-block',
          sourceSnapshot: sourceState,
          sourceExecutionId: 'source-execution',
        },
      })
    )
    expect(executionArgs?.snapshot.metadata).toMatchObject({
      useDraftState: true,
      isClientSession: true,
      sessionUserId: 'session-user-1',
      workflowStateOverride,
    })
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

  it('exports exact provenance for the final response body to an authenticated internal caller', async () => {
    const caller = EXECUTION_CALLERS[4]
    configureExecutionCaller(caller)
    const runProvenance = {
      version: 1,
      complete: true,
      entries: [{ name: 'UNRELATED_SECRET', encryptedValue: 'encrypted-unrelated-secret' }],
    }
    const responseProvenance = {
      version: 1,
      complete: true,
      entries: [{ name: 'CHILD_SECRET', encryptedValue: 'encrypted-child-secret' }],
    }
    loggingSessionMockFns.mockExportResolvedSecretTraceProvenanceForValue.mockReturnValueOnce(
      responseProvenance
    )
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: { ok: true },
      executionState: {
        resolvedSecretTraceProvenance: runProvenance,
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

    expect(response.status).toBe(200)
    expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    await expect(response.json()).resolves.toMatchObject({
      output: { ok: true },
      __resolvedSecretTraceProvenance: responseProvenance,
    })
    expect(
      loggingSessionMockFns.mockExportResolvedSecretTraceProvenanceForValue
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        executionId: 'execution-123',
        output: { ok: true },
      })
    )
  })

  it('includes a thrown execution error in the exact response-provenance boundary', async () => {
    const caller = EXECUTION_CALLERS[4]
    configureExecutionCaller(caller)
    const responseProvenance = {
      version: 1,
      complete: true,
      entries: [{ name: 'ERROR_SECRET', encryptedValue: 'encrypted-error-secret' }],
    }
    loggingSessionMockFns.mockExportResolvedSecretTraceProvenanceForValue.mockReturnValueOnce(
      responseProvenance
    )
    mockExecuteWorkflowCore.mockRejectedValueOnce(new Error('resolved error value'))
    const request = createCallerExecutionRequest(caller, undefined, 'sync')
    request.headers.set('x-sim-request-private-tool-metadata', 'resolved-secret-provenance-v1')

    const response = await POST(request, { params: Promise.resolve({ id: 'workflow-1' }) })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({
      success: false,
      error: 'resolved error value',
      __resolvedSecretTraceProvenance: responseProvenance,
    })
    expect(
      loggingSessionMockFns.mockExportResolvedSecretTraceProvenanceForValue
    ).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'resolved error value' })
    )
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
      principal: {
        kind: 'personal_api_key',
        userId: 'api-user-1',
        keyId: 'personal-key-1',
      },
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
  describe('triggerType override gate', () => {
    it.each([
      ['personal API key', EXECUTION_CALLERS[1]],
      ['workspace API key', EXECUTION_CALLERS[2]],
      ['public API', EXECUTION_CALLERS[3]],
    ] as const)(
      'rejects caller-supplied triggerType "manual" from %s callers',
      async (_name, caller) => {
        configureExecutionCaller(caller)
        const req = createMockRequest(
          'POST',
          { hello: 'world', triggerType: 'manual' },
          { 'Content-Type': 'application/json', ...caller.headers }
        )

        const response = await POST(req, { params: Promise.resolve({ id: 'workflow-1' }) })

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toMatchObject({
          error: 'External callers cannot override triggerType',
        })
        expect(mockPreprocessExecution).not.toHaveBeenCalled()
      }
    )

    it('accepts the redundant explicit "api" triggerType from API-key callers', async () => {
      const caller = EXECUTION_CALLERS[1]
      configureExecutionCaller(caller)
      const req = createMockRequest(
        'POST',
        { hello: 'world', triggerType: 'api' },
        { 'Content-Type': 'application/json', ...caller.headers, 'X-Execution-Mode': 'async' }
      )

      const response = await POST(req, { params: Promise.resolve({ id: 'workflow-1' }) })

      expect(response.status).toBe(202)
    })

    it('still allows internal JWT callers to set triggerType', async () => {
      const caller = EXECUTION_CALLERS[4]
      configureExecutionCaller(caller)
      const req = createMockRequest(
        'POST',
        { hello: 'world', triggerType: 'workflow' },
        { 'Content-Type': 'application/json', ...caller.headers, 'X-Execution-Mode': 'async' }
      )

      const response = await POST(req, { params: Promise.resolve({ id: 'workflow-1' }) })

      expect(response.status).toBe(202)
      expect(mockPreprocessExecution).toHaveBeenCalledWith(
        expect.objectContaining({ triggerType: 'workflow' })
      )
    })
  })
})
