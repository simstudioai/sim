/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  checkPreAuthRate: vi.fn(),
  checkOperationRate: vi.fn(),
  listRuns: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
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

vi.mock('@/lib/workflows/application/list-workflow-runs', () => ({
  listWorkflowRuns: {
    operation: { id: 'workflows.runs.list' },
    execute: mocks.listRuns,
  },
}))

import { NoWorkspaceAccessError, PersonalApiKeysDisabledError } from '@/lib/core/application'
import { GET } from '@/app/api/v2/workflows/[id]/runs/route'

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
const routeContext = () => ({ params: Promise.resolve({ id: 'workflow-1' }) })
const callGet = (query = '') =>
  GET(
    new NextRequest(`http://localhost:3000/api/v2/workflows/workflow-1/runs${query}`),
    routeContext()
  )

const EXECUTIONS = [
  {
    rowId: 'row-2',
    executionId: 'execution-2',
    workflowId: 'workflow-1',
    status: 'paused',
    trigger: 'api',
    startedAt: new Date('2026-08-05T00:02:00Z'),
    endedAt: null,
    durationMs: null,
    costTotal: '0.02',
  },
  {
    rowId: 'row-1',
    executionId: 'execution-1',
    workflowId: 'workflow-1',
    status: 'completed',
    trigger: 'schedule',
    startedAt: new Date('2026-08-05T00:01:00Z'),
    endedAt: new Date('2026-08-05T00:01:03Z'),
    durationMs: 3000,
    costTotal: null,
  },
]

describe('GET /api/v2/workflows/[id]/runs', () => {
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
    mocks.listRuns.mockResolvedValue({
      data: EXECUTIONS,
      nextCursor: null,
      workflowId: 'workflow-1',
      order: 'desc',
    })
  })

  it('lists lightweight run resources through the semantic operation', async () => {
    const response = await callGet()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          runId: 'execution-2',
          workflowId: 'workflow-1',
          status: 'paused',
          trigger: 'api',
          startedAt: '2026-08-05T00:02:00.000Z',
          endedAt: null,
          durationMs: null,
          cost: { total: 0.02 },
        },
        {
          runId: 'execution-1',
          workflowId: 'workflow-1',
          status: 'completed',
          trigger: 'schedule',
          startedAt: '2026-08-05T00:01:00.000Z',
          endedAt: '2026-08-05T00:01:03.000Z',
          durationMs: 3000,
          cost: null,
        },
      ],
      nextCursor: null,
    })
    expect(mocks.listRuns).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({ workflowId: 'workflow-1', limit: 50, order: 'desc' }),
      request: expect.anything(),
    })
  })

  it('encodes the repository cursor using the requested order', async () => {
    mocks.listRuns.mockResolvedValueOnce({
      data: EXECUTIONS,
      nextCursor: { startedAt: EXECUTIONS[1].startedAt, rowId: 'row-1' },
      workflowId: 'workflow-1',
      order: 'asc',
    })

    const body = await (await callGet('?order=asc')).json()

    expect(JSON.parse(Buffer.from(body.nextCursor, 'base64').toString())).toEqual({
      sort: 'startedAt:asc',
      keys: ['2026-08-05T00:01:00.000Z', 'row-1'],
    })
  })

  it('rejects an invalid cursor after API-key admission without calling the use case', async () => {
    const response = await callGet('?cursor=not-a-cursor')

    expect(response.status).toBe(400)
    expect(mocks.authenticate).toHaveBeenCalledOnce()
    expect(mocks.checkOperationRate).toHaveBeenCalledTimes(2)
    expect(mocks.listRuns).not.toHaveBeenCalled()
  })

  it('serves a page containing a run whose output is still being redacted', async () => {
    mocks.listRuns.mockResolvedValueOnce({
      data: [
        {
          rowId: 'row-3',
          executionId: 'execution-3',
          workflowId: 'workflow-1',
          status: 'redacting',
          trigger: 'api',
          startedAt: new Date('2026-08-05T00:03:00Z'),
          endedAt: new Date('2026-08-05T00:03:01Z'),
          durationMs: 1000,
          costTotal: null,
        },
        ...EXECUTIONS,
      ],
      nextCursor: null,
      workflowId: 'workflow-1',
      order: 'desc',
    })

    const response = await callGet()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.map((run: { status: string }) => run.status)).toEqual([
      'redacting',
      'paused',
      'completed',
    ])
  })

  it('rejects redacting as a durable-history filter', async () => {
    const response = await callGet('?status=redacting')

    expect(response.status).toBe(400)
    expect(mocks.listRuns).not.toHaveBeenCalled()
  })

  it('rejects queued as a durable-history filter', async () => {
    const response = await callGet('?status=queued')

    expect(response.status).toBe(400)
    expect(mocks.listRuns).not.toHaveBeenCalled()
  })

  it('conceals workflow authorization failures as absence', async () => {
    mocks.listRuns.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await callGet()

    expect(response.status).toBe(404)
    expect((await response.json()).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Workflow not found',
    })
  })

  it('preserves the personal API-key workspace-policy denial', async () => {
    mocks.listRuns.mockRejectedValueOnce(new PersonalApiKeysDisabledError())

    const response = await callGet()

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
  })

  it('returns a safe error when run storage fails', async () => {
    mocks.listRuns.mockRejectedValueOnce(new Error('database connection details'))

    const response = await callGet()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
