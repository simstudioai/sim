/**
 * @vitest-environment node
 */

import {
  createMockRequest,
  dbChainMockFns,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  loggingSessionMock,
  resetDbChainMock,
  setEnv,
  workflowAuthzMockFns,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceApiKeyAuthorizationError } from '@/lib/core/application'

const {
  MockV2ApiKeyUnauthenticatedError,
  mockAdmissionRelease,
  mockAuthenticateV2ApiKey,
  mockClaimExecutionId,
  mockCheckOperationRate,
  mockCheckPreAuthRate,
  mockEnqueue,
  mockExecuteManualFromBlock,
  mockExecuteManualTrigger,
  mockExecuteWorkflowCore,
  mockGenerateId,
  mockHasDurableExecutionOwner,
  mockReleaseExecutionIdClaim,
  mockReleaseExecutionSlot,
  mockValidatePublicApiAllowed,
} = vi.hoisted(() => ({
  MockV2ApiKeyUnauthenticatedError: class MockV2ApiKeyUnauthenticatedError extends Error {},
  mockAdmissionRelease: vi.fn(),
  mockAuthenticateV2ApiKey: vi.fn(),
  mockClaimExecutionId: vi.fn(),
  mockCheckOperationRate: vi.fn(),
  mockCheckPreAuthRate: vi.fn(),
  mockEnqueue: vi.fn().mockResolvedValue('workflow-execution:execution-123'),
  mockExecuteManualFromBlock: vi.fn(),
  mockExecuteManualTrigger: vi.fn(),
  mockExecuteWorkflowCore: vi.fn(),
  mockGenerateId: vi.fn(() => 'execution-123'),
  mockHasDurableExecutionOwner: vi.fn(),
  mockReleaseExecutionIdClaim: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockValidatePublicApiAllowed: vi.fn(),
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: vi.fn(() => ({ release: mockAdmissionRelease })),
}))

vi.mock('@/lib/workflows/application/execute-manual-workflow', () => ({
  executeManualWorkflowOperation: { execute: mockExecuteManualTrigger },
  executeManualWorkflowFromBlockOperation: { execute: mockExecuteManualFromBlock },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mockAuthenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError: MockV2ApiKeyUnauthenticatedError,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect = mockCheckPreAuthRate
    checkRateLimitDirectOrThrow = mockCheckOperationRate
  },
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: vi.fn().mockResolvedValue('read'),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  PublicApiNotAllowedError: class PublicApiNotAllowedError extends Error {},
  validatePublicApiAllowed: mockValidatePublicApiAllowed,
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)
vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: mockExecuteWorkflowCore,
}))

vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: vi.fn(),
}))

vi.mock('@/lib/workflows/executor/execution-id-claim', () => ({
  claimExecutionId: mockClaimExecutionId,
  hasDurableExecutionOwner: mockHasDurableExecutionOwner,
  releaseExecutionIdClaim: mockReleaseExecutionIdClaim,
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

vi.mock('@/background/workflow-execution', () => ({
  executeWorkflowJob: vi.fn(),
}))

vi.mock('@/lib/workflows/custom-blocks/operations', () => ({
  getCustomBlockRowsForWorkspace: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/blocks/custom/server-overlay', () => ({
  withCustomBlockOverlay: vi.fn(async (_rows: unknown, fn: () => unknown) => fn()),
}))

vi.mock('@/serializer', () => ({
  Serializer: class {
    serializeWorkflow() {
      return { blocks: [] }
    }
  },
}))

vi.mock('@/lib/execution/files', () => ({
  processInputFileFields: vi.fn(async (input: unknown) => input),
}))

vi.mock('@/lib/uploads/utils/user-file-base64.server', () => ({
  hydrateUserFilesWithBase64: vi.fn(async (output: unknown) => output),
}))

vi.mock('@/lib/execution/payloads/serializer', () => ({
  compactExecutionPayload: vi.fn(async (value: unknown) => value),
}))

vi.mock(import('@/lib/execution/payloads/large-value-ref'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, containsLargeValueRef: vi.fn().mockReturnValue(false) }
})

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
  generateShortId: vi.fn(() => 'mock-short-id'),
  isValidUuid: vi.fn((v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ),
}))

import { executeWorkflowService } from '@/lib/workflows/executor/execute-service'
import { attachExecutionResult } from '@/executor/utils/errors'
import { POST } from './route'

const mockPreprocessExecution = executionPreprocessingMockFns.mockPreprocessExecution
const mockAuthorize = workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission
const mockLoadDeployedWorkflowState = workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState
const mockLoadWorkflowFromNormalizedTables =
  workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables

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

const workflowRecord = {
  id: 'workflow-1',
  userId: 'owner-1',
  workspaceId: 'workspace-1',
  isDeployed: true,
  variables: {},
}

const applicationContext = {
  workflowId: 'workflow-1',
  workflow: workflowRecord,
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'actor-1',
}

function callExecute(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const req = createMockRequest('POST', body, {
    'Content-Type': 'application/json',
    'X-API-Key': 'test-key',
    ...headers,
  })
  return POST(req, { params: Promise.resolve({ workflowId: 'workflow-1' }) })
}

function callPublicExecute(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const req = createMockRequest('POST', body, {
    'Content-Type': 'application/json',
    ...headers,
  })
  return POST(req, { params: Promise.resolve({ workflowId: 'workflow-1' }) })
}

function callOAuthExecute(body: Record<string, unknown>) {
  const req = createMockRequest('POST', body, {
    'Content-Type': 'application/json',
    Authorization: 'Bearer sim_oat_token',
  })
  return POST(req, { params: Promise.resolve({ workflowId: 'workflow-1' }) })
}

/**
 * Queues the two reads the anonymous public path makes, in order: the workflow's
 * public-API eligibility, then the workspace billing account it runs as. Keeping
 * them together stops a caller queueing only the first and getting an
 * indistinguishable 401 from the missing second.
 */
function queuePublicWorkflowReads(
  overrides: { isPublicApi?: boolean; isDeployed?: boolean; billedAccountUserId?: string } = {}
) {
  const { isPublicApi = true, isDeployed = true, billedAccountUserId = 'billing-1' } = overrides
  dbChainMockFns.limit.mockResolvedValueOnce([
    { isPublicApi, isDeployed, workspaceId: 'workspace-1' },
  ])
  dbChainMockFns.limit.mockResolvedValueOnce([{ billedAccountUserId }])
}

function authenticatePersonalKey() {
  mockAuthenticateV2ApiKey.mockResolvedValue({
    principal: { kind: 'personal_api_key', userId: 'actor-1', keyId: 'key-1' },
    rateLimitSubjectIds: ['api-key:key-1', 'user:actor-1'],
    rateLimitSubscription: null,
    keyType: 'personal',
  })
}

describe('POST /api/v2/workflows/[workflowId]/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
    mockGenerateId.mockReturnValue('execution-123')
    mockCheckPreAuthRate.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2026-08-08T05:00:00Z'),
    })
    mockCheckOperationRate.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2026-08-08T05:00:00Z'),
    })
    mockAuthenticateV2ApiKey.mockResolvedValue({
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'key-1',
      },
      rateLimitSubjectIds: ['api-key:key-1', 'workspace:workspace-1'],
      rateLimitSubscription: null,
      keyType: 'workspace',
    })
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          workflowId: workflowRecord.id,
          workflow: workflowRecord,
          workspaceId: workflowRecord.workspaceId,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: applicationContext.workspaceId,
          organizationId: applicationContext.workspaceOrganizationId,
          allowPersonalApiKeys: applicationContext.allowPersonalApiKeys,
          billedAccountUserId: applicationContext.billedAccountUserId,
        },
      ])
    mockAuthorize.mockResolvedValue({ allowed: true, workflow: workflowRecord })
    mockClaimExecutionId.mockImplementation(async (executionId: string) => ({
      key: `workflow-execution-id:${executionId}`,
      token: `token-${executionId}`,
    }))
    mockHasDurableExecutionOwner.mockResolvedValue(false)
    mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord,
      actorSubscription: { plan: 'pro' },
      billingAttribution,
      executionTimeout: { sync: 60_000, async: 300_000 },
    })
    mockLoadDeployedWorkflowState.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
    })
    mockExecuteWorkflowCore.mockResolvedValue({
      success: true,
      output: { result: 'done' },
      metadata: {
        duration: 42,
        startTime: '2026-07-31T00:00:00.000Z',
        endTime: '2026-07-31T00:00:01.000Z',
      },
    })
    const manualResult = {
      ok: true,
      executionId: 'execution-123',
      workflowId: 'workflow-1',
      status: 'completed',
      aborted: null,
      output: { result: 'manual done' },
      error: null,
      hasResponseBlock: false,
    }
    mockExecuteManualTrigger.mockResolvedValue(manualResult)
    mockExecuteManualFromBlock.mockResolvedValue(manualResult)
  })

  it('runs sync and returns the run resource in the v2 envelope', async () => {
    const res = await callExecute({ input: { hello: 'world' } })

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Run-Id')).toBe('execution-123')
    const body = await res.json()
    expect(body.data).toMatchObject({
      runId: 'execution-123',
      workflowId: 'workflow-1',
      status: 'completed',
      output: { result: 'done' },
      error: null,
      durationMs: 42,
    })
  })

  it('streams an immediate heartbeat and the same sync result when NDJSON is accepted', async () => {
    vi.useFakeTimers()
    try {
      let finishExecution!: (result: unknown) => void
      mockExecuteWorkflowCore.mockReturnValueOnce(
        new Promise((resolve) => {
          finishExecution = resolve
        })
      )

      const response = await callExecute(
        { input: { hello: 'world' } },
        { Accept: 'application/x-ndjson' }
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/x-ndjson')
      expect(response.headers.get('X-Run-Id')).toBe('execution-123')
      if (!response.body) throw new Error('Expected NDJSON response body')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      expect(JSON.parse(decoder.decode((await reader.read()).value))).toMatchObject({
        type: 'heartbeat',
      })
      expect(mockAdmissionRelease).not.toHaveBeenCalled()
      expect(mockReleaseExecutionIdClaim).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(15_000)
      expect(JSON.parse(decoder.decode((await reader.read()).value))).toMatchObject({
        type: 'heartbeat',
      })

      finishExecution({
        success: true,
        output: { result: 'done' },
        metadata: {
          duration: 42,
          startTime: '2026-07-31T00:00:00.000Z',
          endTime: '2026-07-31T00:00:01.000Z',
        },
      })

      expect(JSON.parse(decoder.decode((await reader.read()).value))).toEqual({
        type: 'final',
        data: {
          runId: 'execution-123',
          workflowId: 'workflow-1',
          status: 'completed',
          output: { result: 'done' },
          error: null,
          startedAt: '2026-07-31T00:00:00.000Z',
          endedAt: '2026-07-31T00:00:01.000Z',
          durationMs: 42,
        },
      })
      expect((await reader.read()).done).toBe(true)
      expect(mockAdmissionRelease).toHaveBeenCalledTimes(1)
      expect(mockReleaseExecutionIdClaim).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the JSON response when NDJSON is explicitly rejected', async () => {
    const response = await callExecute(
      { input: { hello: 'world' } },
      { Accept: 'application/json, application/x-ndjson;q=0' }
    )

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toMatchObject({
      data: { runId: 'execution-123', status: 'completed' },
    })
  })

  it('uses the heartbeat result transport for a manual draft run', async () => {
    authenticatePersonalKey()
    let finishExecution!: (result: unknown) => void
    const pending = new Promise((resolve) => {
      finishExecution = resolve
    })
    mockExecuteManualTrigger.mockResolvedValueOnce({
      ok: true,
      executionId: 'execution-123',
      pending,
      cancel: vi.fn(),
    })

    const response = await callExecute(
      { run: { source: 'manual' }, input: { hello: 'world' } },
      { Accept: 'application/x-ndjson' }
    )

    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    expect(mockExecuteManualTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ mode: 'sync-result-stream' }),
      })
    )
    if (!response.body) throw new Error('Expected NDJSON response body')
    const reader = response.body.getReader()
    await reader.read()

    finishExecution({
      ok: true,
      executionId: 'execution-123',
      workflowId: 'workflow-1',
      status: 'completed',
      aborted: null,
      output: { result: 'manual done' },
      error: null,
      hasResponseBlock: false,
    })

    const final = JSON.parse(new TextDecoder().decode((await reader.read()).value))
    expect(final).toMatchObject({
      type: 'final',
      data: { runId: 'execution-123', output: { result: 'manual done' } },
    })
    expect((await reader.read()).done).toBe(true)
    expect(mockAdmissionRelease).toHaveBeenCalledTimes(1)
  })

  it('returns status failed with a structured error instead of an HTTP error', async () => {
    const error = new Error('Send Email: Invalid credentials')
    Object.assign(error, { blockId: 'block-9', blockName: 'Send Email', blockType: 'gmail' })
    attachExecutionResult(error, {
      success: false,
      output: { partial: true },
      metadata: { duration: 10, startTime: 's', endTime: 'e' },
    })
    mockExecuteWorkflowCore.mockRejectedValue(error)

    const res = await callExecute({ input: {} })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('failed')
    expect(body.data.runId).toBe('execution-123')
    expect(body.data.output).toEqual({ partial: true })
    expect(body.data.error).toEqual({
      message: 'Invalid credentials',
      code: 'BLOCK_EXECUTION_FAILED',
      blockId: 'block-9',
      blockName: 'Send Email',
      blockType: 'gmail',
    })
  })

  it('queues async runs and returns a 202 receipt with the v2 runs statusUrl', async () => {
    const res = await callExecute({ input: {}, async: true })

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.data).toEqual({
      runId: 'execution-123',
      statusUrl: 'http://localhost:3000/api/v2/workflows/workflow-1/runs/execution-123',
    })
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimitCounter: 'async' })
    )
  })

  it('admits keyed execution through request-rate buckets before separate execution preprocessing', async () => {
    const response = await callExecute({ input: {} })

    expect(response.status).toBe(200)
    expect(mockCheckPreAuthRate).toHaveBeenCalledOnce()
    expect(mockCheckOperationRate).toHaveBeenCalledTimes(2)
    expect(mockCheckOperationRate).toHaveBeenCalledWith(
      'v2:workflows.execute:api-key:key-1',
      expect.anything()
    )
    expect(mockCheckOperationRate).toHaveBeenCalledWith(
      'v2:workflows.execute:workspace:workspace-1',
      expect.anything()
    )
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimitCounter: 'sync' })
    )
  })

  it('stops keyed execution at request-rate admission without consuming execution quota', async () => {
    mockCheckOperationRate
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: new Date('2026-08-08T05:00:00Z'),
        retryAfterMs: 12_000,
      })
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 99,
        resetAt: new Date('2026-08-08T05:00:00Z'),
      })

    const response = await callExecute({ input: {} })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('12')
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockClaimExecutionId).not.toHaveBeenCalled()
  })

  it('rejects unknown body keys (strict contract)', async () => {
    const res = await callExecute({ input: {}, triggerType: 'manual' })

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('rejects unknown keys inside the nested run selection', async () => {
    const res = await callExecute({
      run: { source: 'manual', entry: { type: 'trigger', unexpected: true } },
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockExecuteManualTrigger).not.toHaveBeenCalled()
  })

  it('dispatches a personal-key manual trigger run through the manual operation', async () => {
    authenticatePersonalKey()

    const res = await callExecute({
      input: { event: 'created' },
      run: { source: 'manual', entry: { type: 'trigger', blockId: 'slack-trigger' } },
    })

    expect(res.status).toBe(200)
    expect(mockExecuteManualTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ kind: 'personal_api_key' }),
        input: expect.objectContaining({
          workflowId: 'workflow-1',
          input: { event: 'created' },
          mode: 'sync',
          triggerBlockId: 'slack-trigger',
          useMockPayload: false,
        }),
      })
    )
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
  })

  it('dispatches an OAuth manual trigger run through the same manual operation', async () => {
    mockAuthenticateV2ApiKey.mockResolvedValue({
      principal: {
        kind: 'oauth_access_token',
        userId: 'actor-1',
        clientId: 'sim-cli',
        tokenId: 'token-1',
        scopes: ['api:write'],
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
      rateLimitSubjectIds: ['oauth-token:token-1', 'user:actor-1'],
      rateLimitSubscription: null,
      keyType: 'oauth_access_token',
      keyExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    })

    const response = await callOAuthExecute({ run: { source: 'manual' } })

    expect(response.status).toBe(200)
    expect(mockExecuteManualTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ kind: 'oauth_access_token', clientId: 'sim-cli' }),
      })
    )
  })

  it('returns the typed workspace-key denial for manual execution', async () => {
    mockExecuteManualTrigger.mockRejectedValueOnce(new WorkspaceApiKeyAuthorizationError())

    const response = await callExecute({ run: { source: 'manual' } })

    expect(response.status).toBe(403)
    expect((await response.json()).error.details.code).toBe('WORKSPACE_KEY_OPERATION_NOT_PERMITTED')
  })

  it('dispatches from-block with only the exact source run id from the wire', async () => {
    authenticatePersonalKey()

    const res = await callExecute({
      run: {
        source: 'manual',
        entry: { type: 'block', blockId: 'agent-1', sourceRunId: 'source-run-1' },
      },
    })

    expect(res.status).toBe(200)
    expect(mockExecuteManualFromBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          blockId: 'agent-1',
          sourceRunId: 'source-run-1',
          mode: 'sync',
        }),
      })
    )
    expect(mockExecuteManualTrigger).not.toHaveBeenCalled()
  })

  it('passes a manual stream through without changing its response encoding', async () => {
    authenticatePersonalKey()
    mockExecuteManualTrigger.mockResolvedValueOnce({
      ok: true,
      executionId: 'execution-123',
      stream: new Response('data: "[DONE]"\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    })

    const response = await callExecute({ run: { source: 'manual' }, stream: true })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    expect(response.headers.get('X-Run-Id')).toBe('execution-123')
    expect(await response.text()).toBe('data: "[DONE]"\n\n')
    expect(mockExecuteManualTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ mode: 'stream' }) })
    )
  })

  it('carries trusted manual and from-block controls through the shared execution service', async () => {
    const sourceSnapshot = {
      blockStates: {},
      executedBlocks: [],
      blockLogs: [],
      decisions: {},
      completedLoops: [],
      activeExecutionPath: [],
    }
    mockLoadWorkflowFromNormalizedTables.mockResolvedValueOnce({
      blocks: { 'agent-1': { id: 'agent-1', name: 'Agent' } },
      edges: [],
      loops: {},
      parallels: {},
      isFromNormalizedTables: true,
    })

    const result = await executeWorkflowService({
      workflowId: 'workflow-1',
      userId: 'actor-1',
      input: {},
      triggerType: 'manual',
      triggerBlockId: 'trigger-1',
      useDraftState: true,
      runFromBlock: {
        startBlockId: 'agent-1',
        sourceSnapshot,
        sourceExecutionId: 'source-run-1',
      },
      requestId: 'request-1',
      workflowRecord,
      useAuthenticatedUserAsActor: true,
      mode: 'sync',
      requestHeaders: new Headers(),
    })

    expect(result).toMatchObject({ ok: true, executionId: 'execution-123' })
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: 'manual', checkDeployment: false })
    )
    expect(mockLoadWorkflowFromNormalizedTables).toHaveBeenCalledWith('workflow-1')
    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          metadata: expect.objectContaining({
            triggerType: 'manual',
            triggerBlockId: 'trigger-1',
            useDraftState: true,
          }),
        }),
        runFromBlock: {
          startBlockId: 'agent-1',
          sourceSnapshot,
          sourceExecutionId: 'source-run-1',
        },
      })
    )
  })

  it('maps malformed nested output selectors to an input failure', async () => {
    const result = await executeWorkflowService({
      workflowId: 'workflow-1',
      principal: { kind: 'personal_api_key', userId: 'actor-1', keyId: 'key-1' },
      userId: 'actor-1',
      input: {},
      triggerType: 'api',
      requestId: 'request-1',
      workflowRecord,
      selectedOutputs: ['workflow//agent.content'],
      mode: 'stream',
      requestHeaders: new Headers(),
    })

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'input',
        message: 'Invalid selectedOutputs: Invalid output selector: workflow//agent.content',
        statusCode: 400,
      },
    })
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-123')
  })

  it('rejects async manual execution and conflicting mock input before dispatch', async () => {
    authenticatePersonalKey()

    const asyncResponse = await callExecute({ run: { source: 'manual' }, async: true })
    expect(asyncResponse.status).toBe(400)
    expect((await asyncResponse.json()).error.message).toBe(
      'Manual execution does not support async mode'
    )

    const conflictingInput = await callExecute({
      input: { event: 'created' },
      run: { source: 'manual', entry: { type: 'trigger', useMockPayload: true } },
    })
    expect(conflictingInput.status).toBe(400)
    expect((await conflictingInput.json()).error.message).toBe(
      'input and run.entry.useMockPayload cannot be combined'
    )
    expect(mockExecuteManualTrigger).not.toHaveBeenCalled()
  })

  it('rejects async combined with stream or output-shaping options', async () => {
    expect((await callExecute({ async: true, stream: true })).status).toBe(400)
    expect((await callExecute({ async: true, selectedOutputs: ['a.b'] })).status).toBe(400)
    expect((await callExecute({ async: true, includeFileBase64: true })).status).toBe(400)
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('rejects selectedOutputs on a sync request rather than ignoring it', async () => {
    const res = await callExecute({ selectedOutputs: ['agent_1.content'] })

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('selectedOutputs requires stream: true')
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it.each(['includeThinking', 'includeToolCalls'])(
    'rejects %s unless stream is true before checking the protocol header',
    async (option) => {
      const withProtocol = await callExecute(
        { [option]: true },
        { 'X-Sim-Stream-Protocol': 'agent-events-v1' }
      )
      const withoutProtocol = await callExecute({ [option]: true })

      expect(withProtocol.status).toBe(400)
      expect((await withProtocol.json()).error.message).toBe(
        'includeThinking and includeToolCalls require stream: true'
      )
      expect(withoutProtocol.status).toBe(400)
      expect((await withoutProtocol.json()).error.message).toBe(
        'includeThinking and includeToolCalls require stream: true'
      )
      expect(mockPreprocessExecution).not.toHaveBeenCalled()
    }
  )

  it('conceals a workspace-key/workflow mismatch as not found', async () => {
    mockAuthenticateV2ApiKey.mockResolvedValue({
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'other-workspace',
        keyId: 'key-1',
      },
      rateLimitSubjectIds: ['api-key:key-1', 'workspace:other-workspace'],
      rateLimitSubscription: null,
      keyType: 'workspace',
    })

    const res = await callExecute({ input: {} })

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('rejects personal keys when the workspace disallows them', async () => {
    mockAuthenticateV2ApiKey.mockResolvedValue({
      principal: { kind: 'personal_api_key', userId: 'key-user-1', keyId: 'key-1' },
      rateLimitSubjectIds: ['api-key:key-1', 'user:key-user-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    dbChainMockFns.limit.mockReset()
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          workflowId: workflowRecord.id,
          workflow: workflowRecord,
          workspaceId: workflowRecord.workspaceId,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: applicationContext.workspaceId,
          organizationId: applicationContext.workspaceOrganizationId,
          allowPersonalApiKeys: false,
          billedAccountUserId: applicationContext.billedAccountUserId,
        },
      ])

    const res = await callExecute({ input: {} })

    expect(res.status).toBe(403)
  })

  it('returns 409 CONFLICT for a reused X-Run-Id', async () => {
    mockClaimExecutionId.mockResolvedValue(null)

    const res = await callExecute(
      { input: {} },
      { 'X-Run-Id': '11111111-1111-4111-8111-111111111111' }
    )

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.message).toBe('Run ID has already been used')
    expect(body.error.details).toMatchObject({
      code: 'RUN_ID_CONFLICT',
      runId: '11111111-1111-4111-8111-111111111111',
    })
  })

  it('rejects an invalid X-Run-Id', async () => {
    const res = await callExecute({ input: {} }, { 'X-Run-Id': 'invalid run id' })

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('rejects an invalid API key without entering public execution', async () => {
    mockAuthenticateV2ApiKey.mockRejectedValueOnce(
      new MockV2ApiKeyUnauthenticatedError('Invalid API key')
    )

    const response = await callExecute({ input: {} }, { 'X-API-Key': 'invalid' })

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('surfaces the rate-limit failure with Retry-After', async () => {
    mockPreprocessExecution.mockResolvedValue({
      success: false,
      error: {
        message: 'Rate limit exceeded. Please try again later.',
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfterMs: 12_000,
      },
    })

    const res = await callExecute({ input: {} })

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('12')
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('tells a client how long to wait when a dependency is briefly unavailable', async () => {
    mockPreprocessExecution.mockResolvedValue({
      success: false,
      error: {
        message: 'Workflow execution identity is temporarily unavailable',
        statusCode: 503,
      },
    })

    const res = await callExecute({ input: {} })

    expect(res.status).toBe(503)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('never advises a retry when an enqueue may already have started a run', async () => {
    mockPreprocessExecution.mockResolvedValue({
      success: false,
      error: {
        message: 'Async execution queue acceptance could not be confirmed',
        statusCode: 503,
        code: 'ASYNC_ENQUEUE_AMBIGUOUS',
      },
    })

    const res = await callExecute({ input: {} })

    expect(res.status).toBe(503)
    // Retrying without X-Run-Id would start, and bill, a second run of the same workflow.
    expect(res.headers.get('Retry-After')).toBeNull()
    expect((await res.json()).error.details.code).toBe('ASYNC_ENQUEUE_AMBIGUOUS')
  })

  it('runs the anonymous public path sync but refuses async', async () => {
    dbChainMockFns.limit.mockReset()
    queuePublicWorkflowReads()

    const okRes = await callPublicExecute({ input: {} })
    expect(okRes.status).toBe(200)
    expect(mockCheckPreAuthRate.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.select.mock.invocationCallOrder[0]
    )
    expect(mockAuthenticateV2ApiKey).not.toHaveBeenCalled()
    expect(mockCheckOperationRate).not.toHaveBeenCalled()
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimitCounter: 'sync' })
    )

    queuePublicWorkflowReads()
    const asyncRes = await callPublicExecute({ input: {}, async: true })
    expect(asyncRes.status).toBe(400)
  })

  it('never permits manual execution on the anonymous public path', async () => {
    dbChainMockFns.limit.mockReset()
    queuePublicWorkflowReads()

    const response = await callPublicExecute({ run: { source: 'manual' } })

    expect(response.status).toBe(401)
    expect((await response.json()).error.message).toBe(
      'Manual execution requires an OAuth access token or personal API key'
    )
    expect(mockExecuteManualTrigger).not.toHaveBeenCalled()
  })

  it('returns not found when a public workflow disappears before authorization', async () => {
    dbChainMockFns.limit.mockReset()
    queuePublicWorkflowReads()
    mockAuthorize.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: null,
      workspacePermission: null,
    })

    const response = await callPublicExecute({ input: {} })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Workflow not found' },
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('rejects anonymous abuse before looking up the workflow', async () => {
    mockCheckPreAuthRate.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date('2026-08-08T05:00:00Z'),
      retryAfterMs: 10_000,
    })

    const response = await callPublicExecute({ input: {} })

    expect(response.status).toBe(429)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mockValidatePublicApiAllowed).not.toHaveBeenCalled()
    expect(mockAuthenticateV2ApiKey).not.toHaveBeenCalled()
  })

  it('401s non-public workflows without a key', async () => {
    dbChainMockFns.limit.mockReset()
    dbChainMockFns.limit.mockResolvedValueOnce([
      { isPublicApi: false, isDeployed: true, workspaceId: 'workspace-1' },
    ])

    const res = await callPublicExecute({ input: {} })

    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
    expect(mockAuthenticateV2ApiKey).not.toHaveBeenCalled()
    expect(mockCheckOperationRate).not.toHaveBeenCalled()
  })

  it('releases the unused execution-id claim after a failed preprocess', async () => {
    mockPreprocessExecution.mockResolvedValue({
      success: false,
      error: { message: 'Workflow not found', statusCode: 404 },
    })

    const res = await callExecute({ input: {} })

    expect(res.status).toBe(404)
    expect(mockReleaseExecutionIdClaim).toHaveBeenCalled()
  })

  it('rejects a call chain at the depth limit on the keyed and anonymous paths', async () => {
    const maxChain = Array.from({ length: 25 }, (_, i) => `wf-${i}`).join(',')

    const keyed = await callExecute({ input: {} }, { 'X-Sim-Via': maxChain })
    expect(keyed.status).toBe(409)
    const keyedBody = await keyed.json()
    expect(keyedBody.error.code).toBe('CONFLICT')
    expect(keyedBody.error.message).toContain('Maximum workflow call chain depth (25) exceeded')

    dbChainMockFns.limit.mockReset()
    queuePublicWorkflowReads()
    const anonymous = await callPublicExecute({ input: {} }, { 'X-Sim-Via': maxChain })
    expect(anonymous.status).toBe(409)
    expect((await anonymous.json()).error.code).toBe('CONFLICT')

    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
  })

  it('propagates an incoming call chain into the execution instead of resetting it', async () => {
    const keyed = await callExecute({ input: {} }, { 'X-Sim-Via': 'wf-a, wf-b' })
    expect(keyed.status).toBe(200)
    expect(mockExecuteWorkflowCore.mock.calls[0][0].snapshot.metadata.callChain).toEqual([
      'wf-a',
      'wf-b',
      'workflow-1',
    ])

    dbChainMockFns.limit.mockReset()
    queuePublicWorkflowReads()
    const anonymous = await callPublicExecute({ input: {} }, { 'X-Sim-Via': 'wf-a, wf-b' })
    expect(anonymous.status).toBe(200)
    expect(mockExecuteWorkflowCore.mock.calls[1][0].snapshot.metadata.callChain).toEqual([
      'wf-a',
      'wf-b',
      'workflow-1',
    ])
  })

  it('returns a safe error when canonical workflow lookup fails', async () => {
    dbChainMockFns.limit.mockReset()
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database connection details'))

    const response = await callExecute({ input: {} })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })
})
