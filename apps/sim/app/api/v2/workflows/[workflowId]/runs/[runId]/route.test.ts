/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  readRun: vi.fn(),
  authorizeReadRun: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/workflows/application/read-workflow-run', () => ({
  readWorkflowRun: {
    operation: { id: 'workflows.runs.read' },
    execute: mocks.readRun,
    authorize: mocks.authorizeReadRun,
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
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST as cancelPost } from '@/app/api/v2/workflows/[workflowId]/runs/[runId]/cancel/route'
import { GET } from '@/app/api/v2/workflows/[workflowId]/runs/[runId]/route'

const principal = {
  kind: 'workspace_api_key' as const,
  workspaceId: 'workspace-1',
  keyId: 'key-1',
}
const auth = {
  principal,
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
  return GET(req, { params: Promise.resolve({ workflowId: 'workflow-1', runId: 'run-1' }) })
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
  files: null,
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
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.readRun.mockResolvedValue(baseStatus)
    mocks.authorizeReadRun.mockResolvedValue(undefined)
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
        includeFileBase64: false,
        base64MaxBytes: undefined,
      },
      request: expect.anything(),
    })
  })

  it('emits files as null when output was not requested', async () => {
    expect((await (await callStatus()).json()).data.files).toBeNull()
  })

  /**
   * The byte path out of an async run: each produced file arrives with a
   * `downloadPath` even when its bytes are not inlined.
   */
  it('emits run file descriptors with a download path', async () => {
    mocks.readRun.mockResolvedValueOnce({
      ...baseStatus,
      status: 'completed',
      error: null,
      files: [
        {
          id: 'file_1',
          name: 'report.pdf',
          size: 10,
          type: 'application/pdf',
          downloadPath: '/api/v2/workflows/workflow-1/runs/run-1/files/file_1',
          base64: null,
        },
      ],
    })

    const body = await (await callStatus('?includeOutput=true')).json()

    expect(body.data.files).toEqual([
      {
        id: 'file_1',
        name: 'report.pdf',
        size: 10,
        type: 'application/pdf',
        downloadPath: '/api/v2/workflows/workflow-1/runs/run-1/files/file_1',
        base64: null,
      },
    ])
  })

  it('forwards includeFileBase64 and its ceiling to the use case', async () => {
    await callStatus('?includeOutput=true&includeFileBase64=true&base64MaxBytes=4096')

    expect(mocks.readRun).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ includeFileBase64: true, base64MaxBytes: 4096 }),
      })
    )
  })

  /**
   * The contract has always said `includeFileBase64` requires `includeOutput`,
   * and the read honours it: files are projected inside the `includeOutput`
   * branch alone. Nothing enforced it, so the flag parsed, was accepted, and
   * was then dropped — a `200` carrying no files and no reason why.
   */
  it('rejects inlining files without asking for the output they hang off', async () => {
    const response = await callStatus('?includeFileBase64=true')

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('includeOutput')
    expect(mocks.readRun).not.toHaveBeenCalled()
  })

  it('rejects a ceiling for an inlining that was never requested', async () => {
    const response = await callStatus('?base64MaxBytes=4096')

    expect(response.status).toBe(400)
    expect(mocks.readRun).not.toHaveBeenCalled()
  })

  /** Explicitly declining the inlining is not a request for it. */
  it('accepts includeFileBase64=false on its own', async () => {
    expect((await callStatus('?includeFileBase64=false')).status).toBe(200)
  })

  it('rejects a base64MaxBytes above the inline ceiling', async () => {
    const response = await callStatus(
      `?includeOutput=true&includeFileBase64=true&base64MaxBytes=${64 * 1024 * 1024}`
    )

    expect(response.status).toBe(400)
    expect(mocks.readRun).not.toHaveBeenCalled()
  })

  /** The 413 must name the download path so the caller is not left stuck. */
  it('answers 413 naming the download path when a file exceeds the inline ceiling', async () => {
    mocks.readRun.mockRejectedValueOnce(
      new OrchestrationError(
        'payload_too_large',
        'File "report.pdf" (23.1 MB) exceeds the 16 MB inline limit; download it with GET /api/v2/workflows/workflow-1/runs/run-1/files/file_1'
      )
    )

    const response = await callStatus('?includeOutput=true&includeFileBase64=true')

    expect(response.status).toBe(413)
    expect((await response.json()).error.message).toContain(
      '/api/v2/workflows/workflow-1/runs/run-1/files/file_1'
    )
  })

  /**
   * `headSafe: false` — inlining reads object storage, so HEAD answers bodiless
   * without running the read.
   */
  it('answers HEAD bodiless without reading the run', async () => {
    const req = createMockRequest(
      'HEAD',
      undefined,
      {},
      'http://localhost:3000/api/v2/workflows/workflow-1/runs/run-1'
    )
    const response = await GET(req, {
      params: Promise.resolve({ workflowId: 'workflow-1', runId: 'run-1' }),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(mocks.readRun).not.toHaveBeenCalled()
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
      new MockV2ApiKeyUnauthenticatedError('API key or OAuth access token required')
    )

    const response = await callStatus()

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(mocks.readRun).not.toHaveBeenCalled()
  })

  it('keeps cancel on its semantic application operation', async () => {
    const response = await cancelPost(createMockRequest('POST', undefined, {}), {
      params: Promise.resolve({ workflowId: 'workflow-1', runId: 'run-1' }),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      success: true,
      runId: 'run-1',
      reason: 'recorded',
    })
    expect(mocks.cancel).toHaveBeenCalledWith({
      principal,
      input: { runId: 'run-1' },
      request: expect.anything(),
    })
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(v2RouteMocks.operationRate).toHaveBeenCalledWith(
      'v2:workflows.runs.cancel:api-key:key-1',
      expect.anything()
    )
  })

  it('keeps cancellation request-rate admission separate from run control', async () => {
    v2RouteMocks.operationRate
      .mockResolvedValueOnce(OPERATION_RATE_LIMIT_DENIED)
      .mockResolvedValueOnce(V2_OPERATION_RATE_LIMIT_ALLOWED)

    const response = await cancelPost(createMockRequest('POST', undefined, {}), {
      params: Promise.resolve({ workflowId: 'workflow-1', runId: 'run-1' }),
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('returns forbidden when the current workspace role cannot cancel the run', async () => {
    mocks.cancel.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())

    const response = await cancelPost(createMockRequest('POST', undefined, {}), {
      params: Promise.resolve({ workflowId: 'workflow-1', runId: 'run-1' }),
    })

    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Insufficient workspace permissions',
    })
  })

  it('passes a personal-key principal to the cancellation use case', async () => {
    const personalPrincipal = {
      kind: 'personal_api_key' as const,
      userId: 'key-user',
      keyId: 'personal-key',
    }
    v2RouteMocks.authenticate.mockResolvedValueOnce({
      ...auth,
      principal: personalPrincipal,
      rateLimitSubjectIds: ['api-key:personal-key', 'user:key-user'],
      keyType: 'personal',
    })

    const response = await cancelPost(createMockRequest('POST', undefined, {}), {
      params: Promise.resolve({ workflowId: 'workflow-1', runId: 'run-1' }),
    })

    expect(response.status).toBe(200)
    expect(mocks.cancel).toHaveBeenCalledWith({
      principal: personalPrincipal,
      input: { runId: 'run-1' },
      request: expect.anything(),
    })
  })
})
