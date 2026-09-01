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

vi.mock('@/lib/logs/application/list-public-logs', () => ({
  listPublicLogs: { operation: { id: 'logs.list' }, execute: mocks.execute },
}))

import { v2ListLogsContract } from '@/lib/api/contracts/v2/logs'
import { cursorRoute, cursorScopeKey, UNREADABLE_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { cursorSortKey, encodeSortedCursor } from '@/app/api/v2/lib/response'
import { GET } from '@/app/api/v2/logs/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
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
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({
      items: [{ log, executionData: { finalOutput: false, traceSpans: [] } }],
      nextCursorKeys: null,
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
      nextCursorKeys: null,
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
   * The keyset carries only a `(startedAt, id)` position. Binding it to the
   * filters is what stops a cursor taken from an unfiltered walk from resuming
   * inside a `level=error` read at an unrelated point in that shorter sequence.
   */
  it('refuses a cursor replayed under a different filter', async () => {
    mocks.execute.mockResolvedValueOnce({
      items: [{ log, executionData: null }],
      nextCursorKeys: [log.startedAt.toISOString(), 'run-1'],
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
        nextCursorKeys: [log.startedAt.toISOString(), 'run-1'],
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

  /**
   * `includeJobRuns` carries `.default(false)`, so it is present on every parsed
   * query. Stamping it unconditionally would put a constant in every
   * fingerprint and refuse every cursor minted before the param existed, with
   * the misleading "does not match the requested filters" 400 — a caller that changed
   * nothing would be told it changed a filter. The default must therefore
   * contribute nothing to the scope.
   */
  it('resumes a cursor minted before includeJobRuns entered the binding', async () => {
    const legacyCursor = encodeSortedCursor(
      cursorSortKey('startedAt', 'desc'),
      [log.startedAt.toISOString(), 'run-1'],
      cursorScopeKey(cursorRoute(v2ListLogsContract), { workspaceId: WORKSPACE_ID })
    )

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&cursor=${encodeURIComponent(legacyCursor)}`
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalled()
  })

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
   * The keys in a `startedAt` cursor are a timestamp and an id; replayed under
   * `sortBy=cost` they would be compared against a `numeric` column, which is a
   * different sequence entirely rather than a later position in this one.
   */
  it('refuses a cursor replayed under a different sort', async () => {
    const cursor = encodeSortedCursor(
      cursorSortKey('startedAt', 'desc'),
      [log.startedAt.toISOString(), 'run-1'],
      cursorScopeKey(cursorRoute(v2ListLogsContract), { workspaceId: WORKSPACE_ID })
    )

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&sortBy=cost&cursor=${encodeURIComponent(cursor)}`
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: expect.stringContaining('sortBy') },
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  /**
   * An undecodable token says nothing about which param changed — it did not
   * decode far enough to compare a sort or a filter — so answering it with the
   * sort-mismatch message would send the caller after a param it may not have
   * touched. The message is asserted exactly rather than by absence: "does not
   * say sortBy" is satisfied by almost any wording, including one that tells the
   * caller nothing at all.
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

  /**
   * Each param must be a value the contract ACCEPTS, or the 400 comes from
   * schema validation and the case proves nothing about cursor binding — which
   * is why the assertion below pins the reason as well as the status. `error`
   * sat here once: it is a `level`, not a `status`, so it never reached the
   * cursor check at all.
   */
  it.each([['status=failed'], ['workflowName=support'], ['includeJobRuns=true']])(
    'refuses a cursor replayed under a changed %s',
    async (param) => {
      mocks.execute.mockResolvedValueOnce({
        items: [{ log, executionData: null }],
        nextCursorKeys: [log.startedAt.toISOString(), 'run-1'],
        includeFullDetails: false,
        includeFinalOutput: false,
        includeTraceSpans: false,
      })
      const firstPage = await (
        await GET(new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}`))
      ).json()
      mocks.execute.mockClear()

      const response = await GET(
        new NextRequest(
          `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&${param}&cursor=${encodeURIComponent(firstPage.nextCursor)}`
        )
      )

      expect(response.status).toBe(400)
      expect((await response.json()).error.message).toMatch(/cursor/i)
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  it('rejects a status outside the persisted vocabulary and echoes the valid set', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&status=done`)
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.message).toContain('"completed"')
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('forwards a status list as the persisted statuses the filter matches on', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&status=failed,completed`
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          filters: expect.objectContaining({ statuses: ['completed', 'failed'] }),
        }),
      })
    )
  })

  it('rejects a workflowName past the search bound before it reaches an unindexed scan', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&workflowName=${'a'.repeat(201)}`
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  /**
   * A job run and a workflow run whose workflow was deleted both report
   * `workflowId: null`, so the discriminator is the only thing separating them.
   */
  it('projects a job run under its own kind with a derived status', async () => {
    mocks.execute.mockResolvedValueOnce({
      items: [
        {
          log: {
            kind: 'job',
            id: 'job-row-1',
            executionId: 'job-1',
            workspaceId: WORKSPACE_ID,
            level: 'error',
            trigger: 'mothership',
            startedAt: new Date('2026-08-06T00:00:00Z'),
            endedAt: new Date('2026-08-06T00:00:02Z'),
            totalDurationMs: 2000,
            cost: { total: 0.5 },
          },
        },
      ],
      nextCursor: null,
      includeFullDetails: true,
      includeFinalOutput: false,
      includeTraceSpans: false,
    })

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&includeJobRuns=true&details=full`
      )
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data[0]).toEqual({
      kind: 'job',
      runId: 'job-1',
      workflowId: null,
      deploymentVersionId: null,
      status: 'failed',
      level: 'error',
      trigger: 'mothership',
      startedAt: '2026-08-06T00:00:00.000Z',
      endedAt: '2026-08-06T00:00:02.000Z',
      totalDurationMs: 2000,
      cost: { total: 0.5 },
      files: null,
    })
  })

  /**
   * `workflow_execution_logs.files` is a recording, not a manifest: the start
   * block copies every caller-supplied input field verbatim into its output, so
   * a caller can get a `UserFile` naming ANY storage key recorded against its
   * own run. Publishing the blob as stored handed back that key — and a
   * `/api/files/serve/…` URL an API key cannot follow — so the projection keeps
   * only keys under this run's own execution prefix.
   */
  it("publishes only the run's own output files, never a recorded storage key", async () => {
    mocks.execute.mockResolvedValueOnce({
      items: [
        {
          log: {
            ...log,
            files: [
              {
                id: 'file-own',
                name: 'report.pdf',
                size: 1024,
                type: 'application/pdf',
                url: '/api/files/serve/execution/x',
                key: `execution/${WORKSPACE_ID}/workflow-1/run-1/report.pdf`,
              },
              {
                id: 'file-other-workspace',
                name: 'stolen.pdf',
                size: 1,
                type: 'application/pdf',
                url: '/api/files/serve/execution/y',
                key: 'execution/other-workspace/workflow-1/run-1/stolen.pdf',
              },
              {
                id: 'file-other-run',
                name: 'neighbour.pdf',
                size: 1,
                type: 'application/pdf',
                key: `execution/${WORKSPACE_ID}/workflow-1/run-2/neighbour.pdf`,
              },
              {
                id: 'file-input',
                name: 'upload.csv',
                size: 12,
                type: 'text/csv',
                key: `workspace/${WORKSPACE_ID}/upload.csv`,
              },
            ],
          },
          executionData: null,
        },
      ],
      nextCursorKeys: null,
      includeFullDetails: false,
      includeFinalOutput: false,
      includeTraceSpans: false,
    })

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}`)
    )
    const raw = await response.text()

    expect(response.status).toBe(200)
    expect(JSON.parse(raw).data[0].files).toEqual([
      {
        id: 'file-own',
        name: 'report.pdf',
        size: 1024,
        type: 'application/pdf',
        downloadPath: '/api/v2/workflows/workflow-1/runs/run-1/files/file-own',
      },
    ])
    expect(raw).not.toContain('"key"')
    expect(raw).not.toContain('/api/files/serve/')
    expect(raw).not.toContain('stolen.pdf')
    expect(raw).not.toContain('neighbour.pdf')
    expect(raw).not.toContain('upload.csv')
  })

  /**
   * The response schema is `.parse`d on the way out, so a row whose recorded
   * entries are all out of scope has to project to an empty array. A 500 here
   * would be caller-reachable through nothing more than attaching a file.
   */
  it('answers a row whose recorded files are all out of scope with an empty array', async () => {
    mocks.execute.mockResolvedValueOnce({
      items: [
        {
          log: {
            ...log,
            files: [
              { id: 'f', name: 'x', size: 1, type: 'text/plain', key: 'workspace/other/x' },
              { nonsense: true },
              null,
              'not-an-object',
            ],
          },
          executionData: null,
        },
      ],
      nextCursorKeys: null,
      includeFullDetails: false,
      includeFinalOutput: false,
      includeTraceSpans: false,
    })

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data[0].files).toEqual([])
  })

  /** A deleted workflow leaves no run resource to address the bytes through. */
  it('drops recorded files when the run has no workflow to address them under', async () => {
    mocks.execute.mockResolvedValueOnce({
      items: [
        {
          log: {
            ...log,
            workflowId: null,
            files: [
              {
                id: 'file-own',
                name: 'report.pdf',
                size: 1,
                type: 'application/pdf',
                key: `execution/${WORKSPACE_ID}/workflow-1/run-1/report.pdf`,
              },
            ],
          },
          executionData: null,
        },
      ],
      nextCursorKeys: null,
      includeFullDetails: false,
      includeFinalOutput: false,
      includeTraceSpans: false,
    })

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data[0].files).toEqual([])
  })

  it('forwards the requested sort to the application operation', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&sortBy=cost&sortOrder=asc`
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ sortBy: 'cost', sortOrder: 'asc' }),
      })
    )
  })

  it('defaults to the newest runs first', async () => {
    await GET(new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}`))

    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ sortBy: 'startedAt', sortOrder: 'desc' }),
      })
    )
  })

  /** `order` was retired in favour of the surface-wide pair; a strict query rejects it. */
  it('rejects the retired order param', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&order=asc`)
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  /**
   * Job runs record cost as a document and no comparable status, so they cannot
   * participate in those orderings. Dropping the branch silently would answer a
   * request with a sequence the caller did not ask for.
   */
  it.each([['durationMs'], ['cost'], ['status']])(
    'refuses includeJobRuns together with sortBy=%s',
    async (sortBy) => {
      const response = await GET(
        new NextRequest(
          `http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&includeJobRuns=true&sortBy=${sortBy}`
        )
      )

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { code: 'BAD_REQUEST', message: expect.stringContaining('startedAt') },
      })
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  /**
   * An id list compiles to `IN (...)`, so an unbounded one lets the caller
   * choose the query plan's cost. These are the ceilings the retired
   * `POST /logs/query` already enforced on the same filters.
   */
  it.each([
    ['workflowIds', Array.from({ length: 201 }, (_, i) => `w${i}`).join(',')],
    ['triggers', Array.from({ length: 101 }, (_, i) => `t${i}`).join(',')],
    ['folderPaths', Array.from({ length: 101 }, (_, i) => `/f${i}`).join(',')],
  ])('caps the %s list', async (field, value) => {
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

  it('projects typed folder errors', async () => {
    mocks.execute.mockRejectedValueOnce(new OrchestrationError('not_found', 'Folder not found'))

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })
})
