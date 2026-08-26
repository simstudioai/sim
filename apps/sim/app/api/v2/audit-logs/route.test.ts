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
  list: vi.fn(),
  get: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/audit-logs/application/list-audit-logs', () => ({
  listAuditLogs: { operation: { id: 'audit_logs.list' }, execute: mocks.list },
}))

vi.mock('@/lib/audit-logs/application/get-audit-log', () => ({
  getAuditLog: { operation: { id: 'audit_logs.read_detail' }, execute: mocks.get },
}))

import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET as getDetail } from '@/app/api/v2/audit-logs/[auditLogId]/route'
import { GET as listLogs } from '@/app/api/v2/audit-logs/route'

const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'admin-1', keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', 'user:admin-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const log = {
  id: 'audit-1',
  workspaceId: 'workspace-1',
  actorId: 'admin-1',
  actorName: 'Ada',
  actorEmail: 'ada@example.com',
  action: 'workspace.updated',
  resourceType: 'workspace',
  resourceId: 'workspace-1',
  resourceName: 'Engineering',
  description: null,
  metadata: {},
  createdAt: new Date('2026-08-01T00:00:00Z'),
  ipAddress: null,
  userAgent: null,
}

describe('v2 audit-log routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.list.mockResolvedValue({ data: [log], nextCursor: 'next-1' })
    mocks.get.mockResolvedValue({ log })
  })

  it('authenticates and rate-limits before validating organization input', async () => {
    const response = await listLogs(new NextRequest('http://localhost:3000/api/v2/audit-logs'))

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalled()
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('maps list filters into the authorized application operation', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/v2/audit-logs?organizationId=org-1&actorEmail=ada%40example.com'
    )
    const response = await listLogs(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ data: [{ id: 'audit-1' }] })
    /** The domain token travels inside the query-bound wrapper, not bare. */
    expect(JSON.parse(Buffer.from(body.nextCursor, 'base64').toString())).toMatchObject({
      inner: 'next-1',
    })
    expect(mocks.list).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({
        organizationId: 'org-1',
        filters: expect.objectContaining({ actorEmail: 'ada@example.com' }),
      }),
      request,
    })
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
  })

  /**
   * Pins the binding end-to-end — the mint in `present` and the read in
   * `mapInput` — because the contract-level sweep only checks a hand-maintained
   * map of param names and stays green when a route drops the stamp entirely.
   */
  it('refuses a cursor minted under a different filter', async () => {
    const minted = await listLogs(
      new NextRequest(
        'http://localhost:3000/api/v2/audit-logs?organizationId=org-1&actorEmail=ada%40example.com'
      )
    )
    const { nextCursor } = await minted.json()
    expect(nextCursor).toEqual(expect.any(String))

    mocks.list.mockClear()
    const replayed = await listLogs(
      new NextRequest(
        `http://localhost:3000/api/v2/audit-logs?organizationId=org-1&actorEmail=bob%40example.com&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  /**
   * A window bound selects by instant, and the query schema admits every
   * sub-second spelling of one, so the same window written a different way must
   * resume rather than 400.
   */
  it('resumes a cursor whose window bound is respelled to the same instant', async () => {
    const minted = await listLogs(
      new NextRequest(
        'http://localhost:3000/api/v2/audit-logs?organizationId=org-1&startDate=2026-01-01T00%3A00%3A00Z'
      )
    )
    const { nextCursor } = await minted.json()
    expect(nextCursor).toEqual(expect.any(String))

    mocks.list.mockClear()
    const resumed = await listLogs(
      new NextRequest(
        `http://localhost:3000/api/v2/audit-logs?organizationId=org-1&startDate=2026-01-01T00%3A00%3A00.000Z&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(resumed.status).toBe(200)
    expect(mocks.list).toHaveBeenCalled()
  })

  it('resumes a cursor replayed under the filters it was minted with', async () => {
    const minted = await listLogs(
      new NextRequest(
        'http://localhost:3000/api/v2/audit-logs?organizationId=org-1&actorEmail=ada%40example.com'
      )
    )
    const { nextCursor } = await minted.json()

    mocks.list.mockClear()
    const resumed = await listLogs(
      new NextRequest(
        `http://localhost:3000/api/v2/audit-logs?organizationId=org-1&actorEmail=ada%40example.com&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(resumed.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({
        filters: expect.objectContaining({ actorEmail: 'ada@example.com' }),
        cursor: 'next-1',
      }),
      request: expect.anything(),
    })
  })

  /**
   * `resourceType` is split into an `inArray` downstream, so its spelling is a
   * set the query acts on rather than the exact string the caller sent. The
   * cursor must bind the members, not the text.
   */
  it.each([
    ['reordered', 'workflow,file'],
    ['respaced', 'file,%20workflow'],
    ['repeated', 'file,workflow,file'],
  ])('resumes a cursor whose resourceType set is %s', async (_label, respelled) => {
    const minted = await listLogs(
      new NextRequest(
        'http://localhost:3000/api/v2/audit-logs?organizationId=org-1&resourceType=file,workflow'
      )
    )
    const { nextCursor } = await minted.json()
    expect(nextCursor).toEqual(expect.any(String))

    mocks.list.mockClear()
    const resumed = await listLogs(
      new NextRequest(
        `http://localhost:3000/api/v2/audit-logs?organizationId=org-1&resourceType=${respelled}&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(resumed.status).toBe(200)
    expect(mocks.list).toHaveBeenCalled()
  })

  it('still refuses a cursor replayed under a different resourceType set', async () => {
    const minted = await listLogs(
      new NextRequest(
        'http://localhost:3000/api/v2/audit-logs?organizationId=org-1&resourceType=file,workflow'
      )
    )
    const { nextCursor } = await minted.json()

    mocks.list.mockClear()
    const replayed = await listLogs(
      new NextRequest(
        `http://localhost:3000/api/v2/audit-logs?organizationId=org-1&resourceType=file,knowledge&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('projects typed admin-policy failures without leaking internals', async () => {
    mocks.list.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Admin required'))

    const response = await listLogs(
      new NextRequest('http://localhost:3000/api/v2/audit-logs?organizationId=org-1')
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  it('keeps the detail envelope independent', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/v2/audit-logs/audit-1?organizationId=org-1'
    )
    const response = await getDetail(request, {
      params: Promise.resolve({ auditLogId: 'audit-1' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { id: 'audit-1' } })
    expect(mocks.get).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { id: 'audit-1', organizationId: 'org-1' },
      request,
    })
  })
})
