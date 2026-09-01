/**
 * @vitest-environment node
 */
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
  execute: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/billing/application/list-billing-logs', () => ({
  listBillingLogs: { operation: { id: 'billing.logs.list' }, execute: mocks.execute },
}))

import { v2ListBillingLogsContract } from '@/lib/api/contracts/v2/billing'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { UNKNOWN_CURSOR_MESSAGE } from '@/lib/billing/core/usage-log'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/billing/logs/route'
import { encodeScopedCursor } from '@/app/api/v2/lib/response'

/** A ledger cursor exactly as the route mints one, for the filters given. */
function ledgerCursor(
  inner: string,
  filters: { source?: string; workspaceId?: string; period?: string }
): string {
  return encodeScopedCursor(cursorScopeKey(cursorRoute(v2ListBillingLogsContract), filters), inner)
}

const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

describe('GET /api/v2/billing/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'))
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({
      usage: {
        logs: [
          {
            id: 'log-1',
            createdAt: '2026-07-01T00:00:00.000Z',
            source: 'workflow',
            cost: 0.06,
            workspaceId: 'workspace-1',
            workflowId: 'workflow-1',
            workflowName: 'Support Agent',
            executionId: 'run-1',
          },
        ],
        summary: { totalCost: 0, bySource: {} },
        pagination: { hasMore: false },
      },
      creditsByLogId: { 'log-1': 12 },
      scope: 'user',
    })
  })

  it('maps billing filters and preserves the public ledger envelope', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/v2/billing/logs?workspaceId=workspace-1&source=sim-chat'
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          id: 'log-1',
          createdAt: '2026-07-01T00:00:00.000Z',
          source: 'workflow',
          workspaceId: 'workspace-1',
          workflow: { id: 'workflow-1', name: 'Support Agent' },
          runId: 'run-1',
          creditCost: 12,
        },
      ],
      nextCursor: null,
      scope: 'user',
    })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({
        workspaceId: 'workspace-1',
        source: ['copilot', 'workspace-chat'],
      }),
      request,
    })
  })

  /**
   * Two key kinds answer two different questions over the same query, and the
   * row sets are otherwise indistinguishable — a personal key's page is a strict
   * subset. `scope` is what lets a caller tell which one it received.
   */
  it('publishes the scope the ledger read answered', async () => {
    mocks.execute.mockResolvedValueOnce({
      usage: { logs: [], summary: { totalCost: 0, bySource: {} }, pagination: { hasMore: false } },
      creditsByLogId: {},
      scope: 'workspace',
    })

    const response = await GET(new NextRequest('http://localhost:3000/api/v2/billing/logs'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [], nextCursor: null, scope: 'workspace' })
  })

  it('projects an unresolvable cursor as a 400 rather than an unpositioned first page', async () => {
    mocks.execute.mockRejectedValueOnce(
      new OrchestrationError('validation', UNKNOWN_CURSOR_MESSAGE)
    )
    const cursor = ledgerCursor('log-from-another-ledger', { period: '30d' })

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/billing/logs?cursor=${encodeURIComponent(cursor)}`
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: UNKNOWN_CURSOR_MESSAGE },
    })
  })

  /**
   * The ledger cursor is a usage-event id, so it names a row rather than an
   * ordinal — but which rows follow it depends entirely on the window and source
   * filters, so replaying one across a changed filter walks a different ledger
   * and never reaches the entries the caller narrowed to.
   */
  it('rejects a cursor replayed under a different filter without reaching the ledger', async () => {
    const cursor = ledgerCursor('usage-1', { period: '30d' })

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/billing/logs?source=workflow&cursor=${encodeURIComponent(cursor)}`
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: expect.stringContaining('requested filters') },
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  /**
   * An empty inner token reads as falsy in the ledger reader, so no cursor
   * condition is applied and the caller walks the first page again — the very
   * failure {@link UNKNOWN_CURSOR_MESSAGE} exists to make visible.
   */
  it('rejects a cursor whose inner token is empty instead of restarting at page one', async () => {
    const cursor = ledgerCursor('', { period: 'all' })

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/billing/logs?period=all&limit=1&cursor=${encodeURIComponent(cursor)}`
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  /** This operation takes neither param, so naming them sends the caller nowhere. */
  it('names the params a rejected cursor is actually bound to', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/v2/billing/logs?cursor=not-a-cursor')
    )

    const body = await response.json()
    expect(body.error.message).not.toContain('sortBy')
    expect(body.error.message).not.toContain('sortOrder')
  })

  /**
   * `0000` satisfies the published `\d{4}` date-time pattern but names no
   * instant Postgres can store, so the value has to be refused before
   * `resolveDateRange` turns it into a bind parameter.
   */
  it('rejects a year-0000 custom range bound before it can reach the ledger', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/billing/logs?period=custom&startDate=${encodeURIComponent('0000-01-01T00:00:00Z')}`
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: expect.stringContaining('startDate') },
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('authenticates before rejecting invalid custom ranges', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/v2/billing/logs?period=custom')
    )

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects a window bound the effective period would discard', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/v2/billing/logs?startDate=2030-01-01T00:00:00Z&limit=100'
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        message: expect.stringContaining('period=custom'),
      },
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects an endDate paired with an explicit relative period', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/v2/billing/logs?period=7d&endDate=2026-07-01T00:00:00Z'
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects a window bound that is not a UTC ISO 8601 timestamp', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/v2/billing/logs?period=custom&startDate=2026-08-01'
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: expect.stringContaining('UTC ISO 8601') },
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects an inverted custom range instead of answering with an empty page', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/v2/billing/logs?period=custom&startDate=2026-08-06T00:00:00Z&endDate=2026-08-05T00:00:00Z'
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        message: expect.stringContaining('startDate must be before or equal to endDate'),
      },
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('forwards a valid custom range to the ledger read', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/v2/billing/logs?period=custom&startDate=2026-07-01T00:00:00Z&endDate=2026-07-31T00:00:00Z'
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({
        startDate: new Date('2026-07-01T00:00:00Z'),
        endDate: new Date('2026-07-31T00:00:00Z'),
      }),
      request: expect.anything(),
    })
  })
})
