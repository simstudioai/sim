/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/logs/application/query-public-logs', () => ({
  queryPublicLogs: { operation: { id: 'logs.list' }, execute: mocks.execute },
}))

import { POST } from '@/app/api/v2/logs/query/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const log = {
  id: 'log-row-1',
  executionId: 'run-1',
  workflowId: 'workflow-1',
  workspaceId: WORKSPACE_ID,
  deploymentVersionId: null,
  status: 'failed',
  level: 'error',
  trigger: 'schedule',
  startedAt: new Date('2026-08-06T00:00:00Z'),
  endedAt: new Date('2026-08-06T00:00:09Z'),
  totalDurationMs: 9000,
  costTotal: '0.41',
  files: null,
  workflowName: 'Nightly Enrichment',
  workflowDescription: null,
  workflowArchivedAt: null,
}

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/v2/logs/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v2/logs/query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({ logs: [log], nextCursorKeys: null })
  })

  it('returns workflow runs under the v2 list envelope', async () => {
    const response = await POST(post({ workspaceId: WORKSPACE_ID }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          kind: 'workflow',
          runId: 'run-1',
          workflowId: 'workflow-1',
          deploymentVersionId: null,
          status: 'failed',
          level: 'error',
          trigger: 'schedule',
          startedAt: '2026-08-06T00:00:00.000Z',
          endedAt: '2026-08-06T00:00:09.000Z',
          totalDurationMs: 9000,
          cost: { total: 0.41 },
          files: null,
          workflow: {
            id: 'workflow-1',
            name: 'Nightly Enrichment',
            description: null,
            deleted: false,
          },
        },
      ],
      nextCursor: null,
    })
  })

  it('defaults to the same ordering the plain list uses', async () => {
    await POST(post({ workspaceId: WORKSPACE_ID }))

    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ sortBy: 'startedAt', sortOrder: 'desc', limit: 50 }),
      })
    )
  })

  it.each([['durationMs'], ['cost'], ['status']])('orders by %s', async (sortBy) => {
    const response = await POST(post({ workspaceId: WORKSPACE_ID, sortBy, sortOrder: 'asc' }))

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ sortBy, sortOrder: 'asc' }) })
    )
  })

  it('rejects a sort field the query cannot order by, naming the set', async () => {
    const response = await POST(post({ workspaceId: WORKSPACE_ID, sortBy: 'workflowName' }))

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects an unknown body key rather than dropping it', async () => {
    const response = await POST(post({ workspaceId: WORKSPACE_ID, bogus: true }))

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects a fractional limit, which a new list must not clamp', async () => {
    const response = await POST(post({ workspaceId: WORKSPACE_ID, limit: 1.5 }))

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects an inverted window instead of answering an empty page', async () => {
    const response = await POST(
      post({
        workspaceId: WORKSPACE_ID,
        startDate: '2026-08-06T00:00:00Z',
        endDate: '2026-08-05T00:00:00Z',
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        message: expect.stringContaining('startDate must be before or equal to endDate'),
      },
    })
  })

  describe('cursor binding', () => {
    async function firstPageCursor(body: Record<string, unknown>): Promise<string> {
      mocks.execute.mockResolvedValueOnce({
        logs: [log],
        nextCursorKeys: ['2026-08-06', 'log-row-1'],
      })
      const page = await (await POST(post(body))).json()
      expect(page.nextCursor).toEqual(expect.any(String))
      mocks.execute.mockClear()
      return page.nextCursor
    }

    it('resumes under the same query', async () => {
      const cursor = await firstPageCursor({ workspaceId: WORKSPACE_ID })

      const response = await POST(post({ workspaceId: WORKSPACE_ID, cursor }))

      expect(response.status).toBe(200)
      expect(mocks.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ cursorKeys: ['2026-08-06', 'log-row-1'] }),
        })
      )
    })

    it('resumes across a changed page size, which does not change the sequence', async () => {
      const cursor = await firstPageCursor({ workspaceId: WORKSPACE_ID })

      expect((await POST(post({ workspaceId: WORKSPACE_ID, cursor, limit: 10 }))).status).toBe(200)
    })

    it('resumes when an equivalent filter is spelled in a different order', async () => {
      const cursor = await firstPageCursor({
        workspaceId: WORKSPACE_ID,
        workflowIds: ['a', 'b'],
      })

      const response = await POST(
        post({ workspaceId: WORKSPACE_ID, workflowIds: ['b', 'a'], cursor })
      )

      expect(response.status).toBe(200)
    })

    it('refuses a cursor replayed under a different sort', async () => {
      const cursor = await firstPageCursor({ workspaceId: WORKSPACE_ID })

      const response = await POST(post({ workspaceId: WORKSPACE_ID, sortBy: 'cost', cursor }))

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { code: 'BAD_REQUEST', message: expect.stringContaining('sortBy/sortOrder') },
      })
      expect(mocks.execute).not.toHaveBeenCalled()
    })

    it.each([
      ['level', { level: 'error' }],
      ['status', { status: ['failed'] }],
      ['workflowName', { workflowName: 'support' }],
      ['folderPaths', { folderPaths: ['/prod'] }],
      ['minCost', { minCost: 1 }],
    ])('refuses a cursor replayed under a changed %s', async (_field, filter) => {
      const cursor = await firstPageCursor({ workspaceId: WORKSPACE_ID })

      const response = await POST(post({ workspaceId: WORKSPACE_ID, ...filter, cursor }))

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { code: 'BAD_REQUEST', message: expect.stringContaining('requested filters') },
      })
      expect(mocks.execute).not.toHaveBeenCalled()
    })

    it('rejects a token that is not a cursor at all', async () => {
      const response = await POST(post({ workspaceId: WORKSPACE_ID, cursor: 'not-a-cursor' }))

      expect(response.status).toBe(400)
      expect(mocks.execute).not.toHaveBeenCalled()
    })
  })
})
