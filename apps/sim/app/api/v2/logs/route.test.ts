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

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/logs/application/list-public-logs', () => ({
  listPublicLogs: { operation: { id: 'logs.list' }, execute: mocks.execute },
}))

import { v2ListLogsContract } from '@/lib/api/contracts/v2/logs'
import { cursorRoute, cursorScopeKey, UNREADABLE_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { encodeScopedCursor } from '@/app/api/v2/lib/response'
import { GET } from '@/app/api/v2/logs/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const log = {
  executionId: 'run-1',
  workflowId: 'workflow-1',
  workspaceId: WORKSPACE_ID,
  deploymentVersionId: null,
  status: 'completed',
  level: 'info',
  trigger: 'api',
  startedAt: new Date('2026-08-06T00:00:00Z'),
  endedAt: new Date('2026-08-06T00:00:01Z'),
  totalDurationMs: 1000,
  costTotal: null,
  files: null,
  workflowName: 'Support Agent',
  workflowDescription: null,
  workflowArchivedAt: null,
}

describe('GET /api/v2/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({
      items: [{ log, executionData: { finalOutput: false, traceSpans: [] } }],
      nextCursor: null,
      includeFullDetails: true,
      includeFinalOutput: true,
      includeTraceSpans: true,
    })
  })

  it('maps filters into the application operation and preserves diagnostic fields', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&includeFinalOutput=true&includeTraceSpans=true`
    )
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0]).toMatchObject({
      runId: 'run-1',
      workflow: { name: 'Support Agent' },
      finalOutput: false,
      traceSpans: [],
    })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        includeFinalOutput: true,
        includeTraceSpans: true,
      }),
      request,
    })
  })

  it('serves a run whose persisted status is paused', async () => {
    mocks.execute.mockResolvedValue({
      items: [{ log: { ...log, status: 'paused' }, executionData: null }],
      nextCursor: null,
      includeFullDetails: false,
      includeFinalOutput: false,
      includeTraceSpans: false,
    })

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}`)
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0]).toMatchObject({ runId: 'run-1', status: 'paused' })
  })

  /**
   * The run-log cursor is minted by the domain codec, so it carries only its own
   * `(startedAt, id)` position and the requested order. Binding it to the filters
   * is what stops a cursor taken from an unfiltered walk from resuming inside a
   * `level=error` read at an unrelated point in that shorter sequence.
   */
  it('refuses a cursor replayed under a different filter', async () => {
    mocks.execute.mockResolvedValueOnce({
      items: [{ log, executionData: null }],
      nextCursor: Buffer.from(
        JSON.stringify({ startedAt: log.startedAt.toISOString(), id: 'run-1', order: 'desc' })
      ).toString('base64'),
      includeFullDetails: false,
      includeFinalOutput: false,
      includeTraceSpans: false,
    })
    const firstPage = await (
      await GET(new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}`))
    ).json()
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    mocks.execute.mockClear()

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&level=error&cursor=${encodeURIComponent(firstPage.nextCursor)}`
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: expect.stringContaining('requested filters') },
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  /**
   * These three decide how much of each row is rendered, not which rows are in
   * the sequence, so they must stay out of the binding.
   */
  it.each([['details=full'], ['includeTraceSpans=true'], ['includeFinalOutput=true']])(
    'resumes a cursor across a changed %s',
    async (param) => {
      mocks.execute.mockResolvedValueOnce({
        items: [{ log, executionData: null }],
        nextCursor: Buffer.from(
          JSON.stringify({ startedAt: log.startedAt.toISOString(), id: 'run-1', order: 'desc' })
        ).toString('base64'),
        includeFullDetails: false,
        includeFinalOutput: false,
        includeTraceSpans: false,
      })
      const firstPage = await (
        await GET(new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}`))
      ).json()

      const response = await GET(
        new NextRequest(
          `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&${param}&cursor=${encodeURIComponent(firstPage.nextCursor)}`
        )
      )

      expect(response.status).toBe(200)
    }
  )

  it('rejects malformed cursors after admission and before protected reads', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&cursor=not-a-cursor`
      )
    )

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  /**
   * An empty inner token reads as falsy in the domain codec, so no cursor
   * condition is applied and the caller silently gets page one back, with a
   * `nextCursor` inviting it to do the same thing forever.
   */
  it('rejects a cursor whose inner token is empty instead of restarting at page one', async () => {
    const cursor = encodeScopedCursor(
      cursorScopeKey(cursorRoute(v2ListLogsContract), { workspaceId: WORKSPACE_ID, order: 'desc' }),
      ''
    )

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&limit=1&cursor=${encodeURIComponent(cursor)}`
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  /**
   * An undecodable token says nothing about which param changed, and this
   * operation declares neither `sortBy` nor `sortOrder` under a `.strict()`
   * query schema — so the sort-mismatch message would answer one 400 with
   * advice that earns a second. The message is asserted exactly rather than by
   * absence: "does not say sortBy" is satisfied by almost any wording, including
   * one that tells the caller nothing at all.
   */
  it('names the params a rejected cursor is actually bound to', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&cursor=not-a-cursor`
      )
    )

    const body = await response.json()
    expect(body.error.message).toBe(UNREADABLE_CURSOR_MESSAGE)
    expect(body.error.message).toContain('Restart pagination without a cursor')
    expect(body.error.message).not.toContain('sortBy')
    expect(body.error.message).not.toContain('sortOrder')
  })

  /**
   * `total_duration_ms` is an `integer` column, so a value that is not
   * representable as int4 is rejected by Postgres itself — the request has to
   * fail at the contract instead of reaching the query.
   */
  it.each([
    ['minDurationMs', '1.5'],
    ['maxDurationMs', '1.5'],
    ['maxDurationMs', '-0.5'],
    ['minDurationMs', '1e30'],
    ['minDurationMs', '2147483648'],
    ['minDurationMs', '999999999999999999999'],
    ['maxDurationMs', '-1'],
  ])('rejects %s=%s before it can reach the query', async (field, value) => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&${field}=${encodeURIComponent(value)}`
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: expect.stringContaining(field) },
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each([
    ['minDurationMs', '0'],
    ['maxDurationMs', '1000000'],
    ['minDurationMs', '2147483647'],
  ])('accepts %s=%s', async (field, value) => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&${field}=${value}`
      )
    )

    expect(response.status).toBe(200)
  })

  /**
   * `0000` satisfies the published `\d{4}` date-time pattern but names no
   * instant Postgres can store — the proleptic Gregorian calendar has no year
   * zero — so the value has to be refused before it becomes a bind parameter.
   */
  it.each([['startDate'], ['endDate']])(
    'rejects a year-0000 %s before it can reach the query',
    async (field) => {
      const response = await GET(
        new NextRequest(
          `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&${field}=${encodeURIComponent('0000-01-01T00:00:00Z')}`
        )
      )

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { code: 'BAD_REQUEST', message: expect.stringContaining(field) },
      })
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  it('accepts the earliest storable year', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&startDate=${encodeURIComponent('0001-01-01T00:00:00Z')}`
      )
    )

    expect(response.status).toBe(200)
  })

  /**
   * `folderPaths=/,` was already a 400 while the sibling comma lists dropped
   * the empty entry, so one endpoint answered two ways to the same mistake.
   */
  it.each([
    ['workflowIds', 'workflow-1,,workflow-2'],
    ['workflowIds', 'workflow-1,'],
    ['triggers', 'manual,'],
    ['folderPaths', '/,'],
  ])('rejects an empty entry in %s=%s', async (field, value) => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&${field}=${encodeURIComponent(value)}`
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: expect.stringContaining(field) },
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  /** A repeated param arrives as an array, which every v2 schema reads as a missing value. */
  it('names duplication when a query param is sent twice', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&workspaceId=${WORKSPACE_ID}`
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: expect.stringContaining('workspaceId was sent') },
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each([
    ['abc', 'startDate'],
    ['2026-08-06', 'startDate'],
    ['2026-08-06T00:00:00+02:00', 'startDate'],
  ])('rejects %s as a window bound before it can reach the query', async (value, field) => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&${field}=${encodeURIComponent(value)}`
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: expect.stringContaining('startDate') },
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects an unparseable endDate', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&endDate=abc`)
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('forwards a UTC window bound as a Date', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&startDate=2026-08-06T00:00:00Z`
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          filters: expect.objectContaining({ startDate: new Date('2026-08-06T00:00:00Z') }),
        }),
      })
    )
  })

  it('rejects an inverted window instead of answering with an empty page', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&startDate=2026-08-06T00:00:00Z&endDate=2026-08-05T00:00:00Z`
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

  it('projects typed folder errors', async () => {
    mocks.execute.mockRejectedValueOnce(new OrchestrationError('not_found', 'Folder not found'))

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })
})
