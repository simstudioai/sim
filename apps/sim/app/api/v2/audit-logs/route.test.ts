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
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/audit-logs/application/list-audit-logs', () => ({
  listAuditLogs: { operation: { id: 'audit_logs.list' }, execute: mocks.list },
}))

import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
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
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.list.mockResolvedValue({ data: [log], nextCursor: 'next-1' })
  })

  /**
   * No API-key-reachable surface publishes an organization id, so a required
   * `organizationId` made the resource unreachable from a key. The use case
   * derives it from the caller, which means the route has to let it through
   * unset rather than refusing the request itself.
   */
  it('admits a request that names no organization', async () => {
    const response = await listLogs(new NextRequest('http://localhost:3000/api/v2/audit-logs'))

    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({ organizationId: undefined }),
      request: expect.anything(),
    })
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

  /**
   * `organizationId` selects nothing: an account belongs to at most one
   * organization, so naming it and letting it be derived are two spellings of
   * one sequence. Binding the cursor to the spelling refused the genuine next
   * page the moment a caller started supplying the id mid-walk.
   */
  it.each([
    ['derived then named', '', 'organizationId=org-1&'],
    ['named then derived', 'organizationId=org-1&', ''],
  ])(
    'resumes a cursor across both spellings of the organization (%s)',
    async (_l, minting, replaying) => {
      const minted = await listLogs(
        new NextRequest(
          `http://localhost:3000/api/v2/audit-logs?${minting}actorEmail=ada%40example.com`
        )
      )
      const { nextCursor } = await minted.json()
      expect(nextCursor).toEqual(expect.any(String))

      mocks.list.mockClear()
      const resumed = await listLogs(
        new NextRequest(
          `http://localhost:3000/api/v2/audit-logs?${replaying}actorEmail=ada%40example.com&cursor=${encodeURIComponent(nextCursor)}`
        )
      )

      expect(resumed.status).toBe(200)
      expect(mocks.list).toHaveBeenCalledWith({
        principal: auth.principal,
        input: expect.objectContaining({ cursor: 'next-1' }),
        request: expect.anything(),
      })
    }
  )

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
})
