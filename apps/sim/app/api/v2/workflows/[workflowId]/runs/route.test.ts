import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listRuns: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/workflows/application/list-workflow-runs', () => ({
  listWorkflowRuns: {
    operation: { id: 'workflows.runs.list' },
    execute: mocks.listRuns,
  },
}))

import { REFILTERED_CURSOR_MESSAGE, UNREADABLE_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { NoWorkspaceAccessError } from '@/lib/core/application'
import { GET } from '@/app/api/v2/workflows/[workflowId]/runs/route'

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
const routeContext = () => ({ params: Promise.resolve({ workflowId: 'workflow-1' }) })
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

describe('GET /api/v2/workflows/[workflowId]/runs', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.listRuns.mockResolvedValue({
      data: EXECUTIONS,
      nextCursor: null,
      workflowId: 'workflow-1',
      order: 'desc',
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
      filter: expect.any(String),
    })
  })

  /**
   * Resuming a cursor under a different filter is a 400, not a page sequenced
   * against rows the new filter excludes. The assertion above pins that a filter
   * is stamped at all; this pins that the stamp is read back and enforced.
   */
  it('refuses a cursor minted under a different filter', async () => {
    mocks.listRuns.mockResolvedValueOnce({
      data: EXECUTIONS,
      nextCursor: { startedAt: EXECUTIONS[1].startedAt, rowId: 'row-1' },
      workflowId: 'workflow-1',
      order: 'asc',
    })

    const { nextCursor } = await (await callGet('?order=asc&status=completed')).json()
    expect(nextCursor).toEqual(expect.any(String))

    mocks.listRuns.mockClear()
    const replayed = await callGet(
      `?order=asc&status=failed&cursor=${encodeURIComponent(nextCursor)}`
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.listRuns).not.toHaveBeenCalled()
  })

  /**
   * This list orders by the single `order` param — its query schema is
   * `.strict()` and declares no `sortBy` — so the sort-mismatch wording would
   * answer one 400 with advice that earns a second.
   */
  it('names a cursor with unusable keys unreadable rather than blaming sortBy', async () => {
    mocks.listRuns.mockResolvedValueOnce({
      data: EXECUTIONS,
      nextCursor: { startedAt: EXECUTIONS[1].startedAt, rowId: 'row-1' },
      workflowId: 'workflow-1',
      order: 'desc',
    })

    const { nextCursor } = await (await callGet()).json()
    const payload = JSON.parse(Buffer.from(nextCursor, 'base64').toString())
    const tampered = Buffer.from(
      JSON.stringify({ ...payload, keys: ['not-a-date', 'row-1'] })
    ).toString('base64')

    mocks.listRuns.mockClear()
    const response = await callGet(`?cursor=${encodeURIComponent(tampered)}`)

    expect(response.status).toBe(400)
    const { error } = await response.json()
    expect(error.message).toBe(UNREADABLE_CURSOR_MESSAGE)
    expect(error.message).not.toMatch(/sortBy/)
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
})
