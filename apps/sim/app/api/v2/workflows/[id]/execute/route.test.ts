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

const {
  mockAuthenticateV1Request,
  mockClaimExecutionId,
  mockEnqueue,
  mockExecuteWorkflowCore,
  mockGenerateId,
  mockGetWorkspaceBillingSettings,
  mockHasDurableExecutionOwner,
  mockReleaseExecutionIdClaim,
  mockReleaseExecutionSlot,
  mockValidatePublicApiAllowed,
} = vi.hoisted(() => ({
  mockAuthenticateV1Request: vi.fn(),
  mockClaimExecutionId: vi.fn(),
  mockEnqueue: vi.fn().mockResolvedValue('workflow-execution:execution-123'),
  mockExecuteWorkflowCore: vi.fn(),
  mockGenerateId: vi.fn(() => 'execution-123'),
  mockGetWorkspaceBillingSettings: vi.fn(),
  mockHasDurableExecutionOwner: vi.fn(),
  mockReleaseExecutionIdClaim: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockValidatePublicApiAllowed: vi.fn(),
}))

vi.mock('@/app/api/v1/auth', () => ({
  authenticateV1Request: mockAuthenticateV1Request,
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

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { attachExecutionResult } from '@/executor/utils/errors'
import { POST } from './route'

const mockPreprocessExecution = executionPreprocessingMockFns.mockPreprocessExecution
const mockAuthorize = workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission
const mockLoadDeployedWorkflowState = workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState

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

function callExecute(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const req = createMockRequest('POST', body, {
    'Content-Type': 'application/json',
    ...headers,
  })
  return POST(req, { params: Promise.resolve({ id: 'workflow-1' }) })
}

describe('POST /api/v2/workflows/[id]/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
    mockGenerateId.mockReturnValue('execution-123')
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: true,
      userId: 'key-user-1',
      keyType: 'workspace',
      workspaceId: 'workspace-1',
    })
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
  })

  it('runs sync and returns the execution resource in the v2 envelope', async () => {
    const res = await callExecute({ input: { hello: 'world' } })

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Execution-Id')).toBe('execution-123')
    const body = await res.json()
    expect(body.data).toMatchObject({
      executionId: 'execution-123',
      workflowId: 'workflow-1',
      status: 'completed',
      output: { result: 'done' },
      error: null,
      durationMs: 42,
    })
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
    expect(body.data.executionId).toBe('execution-123')
    expect(body.data.output).toEqual({ partial: true })
    expect(body.data.error).toEqual({
      message: 'Invalid credentials',
      code: 'BLOCK_EXECUTION_FAILED',
      blockId: 'block-9',
      blockName: 'Send Email',
      blockType: 'gmail',
    })
  })

  it('queues async runs and returns a 202 receipt with the v2 executions statusUrl', async () => {
    const res = await callExecute({ input: {}, async: true })

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.data).toEqual({
      executionId: 'execution-123',
      statusUrl: 'http://localhost:3000/api/v2/workflows/workflow-1/executions/execution-123',
    })
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimitCounter: 'async' })
    )
  })

  it('404s the whole surface when the v2-api flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callExecute({ input: {} })

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('rejects unknown body keys (strict contract)', async () => {
    const res = await callExecute({ input: {}, triggerType: 'manual' })

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('rejects async combined with stream or output-shaping options', async () => {
    expect((await callExecute({ async: true, stream: true })).status).toBe(400)
    expect((await callExecute({ async: true, selectedOutputs: ['a.b'] })).status).toBe(400)
    expect((await callExecute({ async: true, includeFileBase64: true })).status).toBe(400)
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('masks a workspace-key/workflow mismatch as 404', async () => {
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: true,
      userId: 'key-user-1',
      keyType: 'workspace',
      workspaceId: 'other-workspace',
    })

    const res = await callExecute({ input: {} })

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('rejects personal keys when the workspace disallows them', async () => {
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: true,
      userId: 'key-user-1',
      keyType: 'personal',
    })
    mockGetWorkspaceBillingSettings.mockResolvedValue({ allowPersonalApiKeys: false })

    const res = await callExecute({ input: {} })

    expect(res.status).toBe(403)
  })

  it('returns 409 CONFLICT for a reused X-Execution-Id', async () => {
    mockClaimExecutionId.mockResolvedValue(null)

    const res = await callExecute(
      { input: {} },
      { 'X-Execution-Id': '11111111-1111-4111-8111-111111111111' }
    )

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.details).toMatchObject({
      code: 'EXECUTION_ID_CONFLICT',
      executionId: '11111111-1111-4111-8111-111111111111',
    })
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

  it('runs the anonymous public path sync but refuses async', async () => {
    mockAuthenticateV1Request.mockResolvedValue({ authenticated: false, error: 'API key required' })
    dbChainMockFns.limit.mockResolvedValueOnce([
      { isPublicApi: true, isDeployed: true, userId: 'owner-1', workspaceId: 'workspace-1' },
    ])

    const okRes = await callExecute({ input: {} })
    expect(okRes.status).toBe(200)

    mockAuthenticateV1Request.mockResolvedValue({ authenticated: false, error: 'API key required' })
    dbChainMockFns.limit.mockResolvedValueOnce([
      { isPublicApi: true, isDeployed: true, userId: 'owner-1', workspaceId: 'workspace-1' },
    ])
    const asyncRes = await callExecute({ input: {}, async: true })
    expect(asyncRes.status).toBe(400)
  })

  it('401s non-public workflows without a key', async () => {
    mockAuthenticateV1Request.mockResolvedValue({ authenticated: false, error: 'API key required' })
    dbChainMockFns.limit.mockResolvedValueOnce([
      { isPublicApi: false, isDeployed: true, userId: 'owner-1', workspaceId: 'workspace-1' },
    ])

    const res = await callExecute({ input: {} })

    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
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
})
