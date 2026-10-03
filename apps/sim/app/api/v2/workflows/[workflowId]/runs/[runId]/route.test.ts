import {
  createMockRequest,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
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

import { NoWorkspaceAccessError } from '@/lib/core/application'
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

describe('v2 run detail and cancel adapters', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.readRun.mockResolvedValue(baseStatus)
    mocks.authorizeReadRun.mockResolvedValue(undefined)
  })

  it('emits files as null when output was not requested', async () => {
    expect((await (await callStatus()).json()).data.files).toBeNull()
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

  it('rejects a base64MaxBytes above the inline ceiling', async () => {
    const response = await callStatus(
      `?includeOutput=true&includeFileBase64=true&base64MaxBytes=${64 * 1024 * 1024}`
    )

    expect(response.status).toBe(400)
    expect(mocks.readRun).not.toHaveBeenCalled()
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
})
