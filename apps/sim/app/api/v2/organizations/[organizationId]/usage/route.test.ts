/** @vitest-environment node */

import { recordAudit } from '@sim/audit'
import type { OAuthAccessTokenPrincipal, Principal } from '@sim/auth/principal'
import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  preauth: vi.fn(),
  rate: vi.fn(),
  config: vi.fn(),
  subscription: vi.fn(),
  entitled: vi.fn(),
  limit: vi.fn(),
  used: vi.fn(),
  setLimit: vi.fn(),
  limitTarget: vi.fn(),
  totals: vi.fn(),
  series: vi.fn(),
  breakdown: vi.fn(),
  logs: vi.fn(),
  Unauthenticated: class extends Error {},
}))
vi.mock('@sim/audit', async (original) => ({
  ...(await original<typeof import('@sim/audit')>()),
  recordAudit: vi.fn(),
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: mocks.Unauthenticated,
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauth
    checkRateLimitDirectOrThrow = mocks.rate
  },
  getRateLimit: () => ({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@/lib/billing/core/billing', () => ({ getOrganizationSubscription: mocks.subscription }))
vi.mock('@/lib/billing/core/subscription', async (original) => ({
  ...(await original<typeof import('@/lib/billing/core/subscription')>()),
  isOrganizationFeatureEntitled: mocks.entitled,
}))
vi.mock('@/lib/billing/organizations/member-limits', () => ({
  getOrgMemberUsageLimit: mocks.limit,
  getOrgMemberUsageForCurrentPeriod: mocks.used,
  setOrgMemberUsageLimit: mocks.setLimit,
  isOrgMemberUsageLimitTarget: mocks.limitTarget,
}))
vi.mock('@/lib/billing/core/usage-analytics-queries', () => ({
  readUsageTotals: mocks.totals,
  readUsageTimeSeries: mocks.series,
  readUsageBreakdown: mocks.breakdown,
  readUsageEntityNames: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('@/lib/billing/core/usage-log', () => ({ getBillingEntityUsageLogs: mocks.logs }))

import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { decodeCursor, encodeCursor } from '@/app/api/v2/lib/response'
import {
  GET as getLimit,
  PATCH as setLimit,
} from '@/app/api/v2/organizations/[organizationId]/members/[userId]/usage-limit/route'
import { GET as breakdown } from '@/app/api/v2/organizations/[organizationId]/usage/breakdown/route'
import { GET as events } from '@/app/api/v2/organizations/[organizationId]/usage/events/route'
import { GET as summary } from '@/app/api/v2/organizations/[organizationId]/usage/summary/route'

const personal = { kind: 'personal_api_key', userId: 'actor', keyId: 'key' } as const
const oauth: OAuthAccessTokenPrincipal = {
  kind: 'oauth_access_token',
  userId: 'actor',
  tokenId: 'token',
  clientId: 'client',
  scopes: ['api:read', 'api:write'],
  expiresAt: new Date('2099-01-01'),
}
const context = { params: Promise.resolve({ organizationId: 'org', userId: 'external-user' }) }
const usageContext = { params: Promise.resolve({ organizationId: 'org' }) }
function authenticate(principal: Principal) {
  mocks.authenticate.mockResolvedValue({
    principal,
    keyType: 'personal',
    rateLimitSubjectIds: ['key:key'],
    rateLimitSubscription: null,
  })
}
function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/v2/organizations/org/${path}`, {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: {
      'x-api-key': 'key',
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function admin() {
  queueTableRows(member, [{ role: 'admin' }])
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  setEnvFlags({ isHosted: true, isBillingEnabled: true })
  authenticate(personal)
  const admission = {
    allowed: true,
    remaining: 99,
    resetAt: new Date(Date.now() + 60_000),
    retryAfterMs: 0,
  }
  mocks.preauth.mockResolvedValue(admission)
  mocks.rate.mockResolvedValue(admission)
  mocks.config.mockResolvedValue(null)
  mocks.entitled.mockResolvedValue(true)
  mocks.subscription.mockResolvedValue({
    plan: 'enterprise',
    periodStart: new Date('2026-08-01'),
    periodEnd: new Date('2026-09-01'),
  })
  mocks.limit.mockResolvedValue(2)
  mocks.used.mockResolvedValue(1)
  mocks.limitTarget.mockResolvedValue(true)
  mocks.setLimit.mockResolvedValue(undefined)
  mocks.totals.mockResolvedValue({ cost: 1 })
  mocks.series.mockResolvedValue([])
  mocks.breakdown.mockResolvedValue([])
  mocks.logs.mockResolvedValue({ logs: [], pagination: { hasMore: false, nextCursorKeys: null } })
})
afterEach(() => vi.useRealTimers())
afterAll(resetEnvFlagsMock)

describe('organization credit-limit API', () => {
  it.each([personal, oauth])(
    'admits $kind and preserves external-user credit units and one semantic audit',
    async (principal) => {
      authenticate(principal)
      admin()
      const response = await setLimit(
        request('members/external-user/usage-limit', { creditLimit: 400 }),
        context
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: { creditLimit: 400 } })
      expect(mocks.setLimit).toHaveBeenCalledWith('org', 'external-user', 2, 'actor')
      expect(mocks.limitTarget).toHaveBeenCalledWith('org', 'external-user')
      expect(recordAudit).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          actorId: 'actor',
          resourceId: 'org',
          metadata: expect.objectContaining({
            organizationId: 'org',
            targetUserId: 'external-user',
            creditLimit: 400,
          }),
        })
      )
    }
  )

  it.each([null, 0])('supports the distinct cap value %s', async (creditLimit) => {
    admin()
    expect(
      (await setLimit(request('members/external-user/usage-limit', { creditLimit }), context))
        .status
    ).toBe(200)
    expect(mocks.setLimit).toHaveBeenCalledWith('org', 'external-user', creditLimit, 'actor')
  })

  it('returns credits and the resolved organization billing interval', async () => {
    admin()
    const response = await getLimit(request('members/external-user/usage-limit'), context)
    expect(await response.json()).toEqual({
      data: { creditsUsed: 200, creditLimit: 400, billingInterval: 'month' },
    })
    expect(mocks.used).toHaveBeenCalledWith(
      'org',
      'external-user',
      await mocks.subscription.mock.results[0].value
    )
  })

  it('does not require Usage Monitoring for hosted caps', async () => {
    admin()
    mocks.entitled.mockResolvedValue(false)
    expect((await getLimit(request('members/external-user/usage-limit'), context)).status).toBe(200)
    expect(mocks.entitled).not.toHaveBeenCalled()
  })

  it('preserves hosted-only admission before body validation', async () => {
    setEnvFlags({ isHosted: false })
    expect(
      (await setLimit(request('members/external-user/usage-limit', { invalid: true }), context))
        .status
    ).toBe(404)
    expect(mocks.setLimit).not.toHaveBeenCalled()
  })

  it('refuses reads for a user outside the organization before loading usage', async () => {
    admin()
    mocks.limitTarget.mockResolvedValue(false)
    const response = await getLimit(request('members/external-user/usage-limit'), context)
    expect(response.status).toBe(404)
    expect(mocks.limit).not.toHaveBeenCalled()
    expect(mocks.used).not.toHaveBeenCalled()
    expect(mocks.subscription).not.toHaveBeenCalled()
  })

  it.each([10, null])(
    'refuses cap %s for a user outside the organization without mutation or audit',
    async (creditLimit) => {
      admin()
      mocks.limitTarget.mockResolvedValue(false)
      const response = await setLimit(
        request('members/external-user/usage-limit', { creditLimit }),
        context
      )
      expect(response.status).toBe(404)
      expect(mocks.setLimit).not.toHaveBeenCalled()
      expect(recordAudit).not.toHaveBeenCalled()
    }
  )

  it.each([{}, { creditLimit: -1 }, { creditLimit: 0.5 }, { creditLimit: 100, unexpected: true }])(
    'rejects malformed cap %j before protected reads',
    async (body) => {
      expect(
        (await setLimit(request('members/external-user/usage-limit', body), context)).status
      ).toBe(400)
      expect(mocks.limitTarget).not.toHaveBeenCalled()
      expect(recordAudit).not.toHaveBeenCalled()
    }
  )

  it('refuses read-only OAuth writes before target reads', async () => {
    authenticate({ ...oauth, scopes: ['api:read'] })
    expect(
      (await setLimit(request('members/external-user/usage-limit', { creditLimit: 10 }), context))
        .status
    ).toBe(403)
    expect(mocks.limitTarget).not.toHaveBeenCalled()
  })
})

describe('organization usage API authorization and bounds', () => {
  it.each([personal, oauth])(
    'reads summary through $kind and reports credit units',
    async (principal) => {
      authenticate(principal)
      admin()
      const response = await summary(request('usage/summary'), usageContext)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        data: { totals: { credits: 200 }, previousTotals: null },
      })
      expect(mocks.entitled).toHaveBeenCalledWith('org', expect.any(Boolean))
    }
  )

  it('serializes local calendar buckets as UTC timestamps across daylight saving', async () => {
    admin()
    const response = await summary(
      request(
        'usage/summary?preset=custom&startDate=2026-03-08&endDate=2026-03-09&timezone=America%2FLos_Angeles'
      ),
      usageContext
    )
    expect(response.status).toBe(200)
    expect(
      (await response.json()).data.series.map((point: { timestamp: string }) => point.timestamp)
    ).toEqual(['2026-03-08T08:00:00.000Z', '2026-03-09T07:00:00.000Z'])
  })

  it('keeps weekly bucket boundaries in the selected timezone for billing presets', async () => {
    admin()
    mocks.subscription.mockResolvedValue({
      plan: 'enterprise',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-07-01'),
    })
    const response = await summary(
      request('usage/summary?preset=current-period&timezone=America%2FNew_York'),
      usageContext
    )
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.bucket).toBe('week')
    expect(data.series[0].timestamp).toBe('2025-12-29T05:00:00.000Z')
    expect(data.series).toContainEqual({
      timestamp: '2026-03-09T04:00:00.000Z',
      credits: 0,
      events: 0,
    })
  })

  it.each([
    ['member', 403],
    [null, 404],
  ] as const)('refuses current organization role %s', async (role, status) => {
    queueTableRows(member, role ? [{ role }] : [])
    expect((await summary(request('usage/summary'), usageContext)).status).toBe(status)
    expect(mocks.entitled).not.toHaveBeenCalled()
    expect(mocks.totals).not.toHaveBeenCalled()
  })

  it.each([
    { ...personal, kind: 'workspace_api_key' as const, workspaceId: 'ws' },
    { ...oauth, scopes: [] },
    { ...oauth, expiresAt: new Date('2000-01-01') },
  ])('refuses invalid principal or scope before entitlement reads', async (principal) => {
    authenticate(principal)
    expect((await summary(request('usage/summary'), usageContext)).status).toBe(
      principal.kind === 'oauth_access_token' && principal.expiresAt < new Date() ? 401 : 403
    )
    expect(mocks.entitled).not.toHaveBeenCalled()
  })

  it.each([
    [personal, 'disablePersonalApiKeys'],
    [oauth, 'disableOAuthAppAccess'],
    [{ ...oauth, clientId: SIM_CLI_CLIENT_ID }, 'disableCliAccess'],
  ] as const)('rechecks current credential policy %s / %s', async (principal, field) => {
    authenticate(principal)
    admin()
    mocks.config.mockResolvedValue({ ...DEFAULT_PERMISSION_GROUP_CONFIG, [field]: true })
    expect((await summary(request('usage/summary'), usageContext)).status).toBe(403)
    expect(mocks.totals).not.toHaveBeenCalled()
  })

  it('retains the Usage Monitoring entitlement', async () => {
    admin()
    mocks.entitled.mockResolvedValue(false)
    expect((await events(request('usage/events'), usageContext)).status).toBe(403)
    expect(mocks.logs).not.toHaveBeenCalled()
  })

  it.each([
    'preset=custom',
    'preset=30d&startDate=2026-01-01',
    'preset=custom&startDate=2026-01-01&endDate=2026-05-01',
    'preset=custom&startDate=2026-02-30&endDate=2026-03-01',
    'unknown=value',
    'preset=custom&startDate=9999-12-31&endDate=9999-12-31',
  ])('rejects ambiguous or unbounded query %s', async (query) => {
    expect((await summary(request(`usage/summary?${query}`), usageContext)).status).toBe(400)
    expect(mocks.totals).not.toHaveBeenCalled()
  })

  it('rejects an oversized billing period before analytics reads', async () => {
    admin()
    mocks.subscription.mockResolvedValue({
      plan: 'enterprise',
      periodStart: new Date('2020-01-01'),
      periodEnd: new Date('2026-01-01'),
    })
    expect(
      (await summary(request('usage/summary?preset=current-period'), usageContext)).status
    ).toBe(400)
    expect(mocks.totals).not.toHaveBeenCalled()
  })

  it('reports an oversized breakdown instead of presenting a partial total', async () => {
    admin()
    mocks.breakdown.mockResolvedValue(
      Array.from({ length: 10_001 }, (_, index) => ({ key: `user-${index}`, cost: 1, events: 1 }))
    )
    const response = await breakdown(request('usage/breakdown?dimension=member'), usageContext)
    expect(response.status).toBe(413)
    expect(mocks.breakdown).toHaveBeenCalledWith(expect.any(Array), 'member', undefined, 10_000)
  })
})

describe('organization usage event cursors', () => {
  const customQuery =
    'preset=custom&startDate=2026-03-08&endDate=2026-03-09&timezone=America%2FLos_Angeles&source=sim-chat&limit=1'
  const eventKeys = ['2026-03-09T12:00:00.000Z', 'event-1']

  async function firstCustomPage() {
    admin()
    mocks.logs.mockResolvedValueOnce({
      logs: [],
      pagination: { hasMore: true, nextCursorKeys: eventKeys },
    })
    const response = await events(request(`usage/events?${customQuery}`), usageContext)
    expect(response.status).toBe(200)
    return (await response.json()).nextCursor as string
  }

  it('preserves the exact custom calendar range across daylight saving on continuation', async () => {
    const cursor = await firstCustomPage()
    admin()
    const response = await events(
      request(`usage/events?${customQuery}&cursor=${encodeURIComponent(cursor)}`),
      usageContext
    )
    expect(response.status).toBe(200)
    expect(mocks.logs).toHaveBeenCalledTimes(2)
    for (const [, options] of mocks.logs.mock.calls) {
      expect(options).toMatchObject({
        startDate: new Date('2026-03-08T08:00:00.000Z'),
        endDate: new Date('2026-03-10T07:00:00.000Z'),
        endDateExclusive: true,
      })
      expect(options.billingPeriod).toBeUndefined()
    }
    expect(mocks.logs.mock.calls[1][1].keyset.cursorKeys).toEqual(eventKeys)
  })

  it.each([
    ['range', '2026-03-07T08:00:00.000Z', '2026-03-10T07:00:00.000Z'],
    ['range', '2026-03-08T08:00:00.000Z', '2026-03-11T07:00:00.000Z'],
    ['period', '2026-03-08T08:00:00.000Z', '2026-03-10T07:00:00.000Z'],
  ])('rejects tampered custom window %s / %s / %s before ledger reads', async (...windowKeys) => {
    const cursor = await firstCustomPage()
    const payload = decodeCursor<Record<string, unknown>>(cursor)
    expect(payload).not.toBeNull()
    const tampered = encodeCursor({ ...payload, keys: [...windowKeys, ...eventKeys] })
    admin()
    const response = await events(
      request(`usage/events?${customQuery}&cursor=${encodeURIComponent(tampered)}`),
      usageContext
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        message: 'Usage event cursor does not match the requested custom range; restart pagination',
      },
    })
    expect(mocks.logs).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['startDate', '2026-03-07'],
    ['endDate', '2026-03-10'],
    ['timezone', 'UTC'],
    ['source', 'workflow'],
    ['sortOrder', 'asc'],
  ])('rejects a custom cursor reused with changed %s', async (filter, value) => {
    const cursor = await firstCustomPage()
    const query = new URLSearchParams(customQuery)
    query.set(filter, value)
    query.set('cursor', cursor)
    const response = await events(request(`usage/events?${query}`), usageContext)
    expect(response.status).toBe(400)
    expect(mocks.logs).toHaveBeenCalledTimes(1)
  })

  it('keeps the first billing predicate after a subscription period changes', async () => {
    admin()
    mocks.logs.mockResolvedValueOnce({
      logs: [],
      pagination: { hasMore: true, nextCursorKeys: ['2026-08-15T00:00:00.000Z', 'event-1'] },
    })
    const first = await events(request('usage/events?preset=current-period'), usageContext)
    expect(first.status).toBe(200)
    const { nextCursor } = await first.json()
    mocks.subscription.mockResolvedValue({
      plan: 'enterprise',
      periodStart: new Date('2026-09-01'),
      periodEnd: new Date('2026-10-01'),
    })
    admin()
    const second = await events(
      request(`usage/events?preset=current-period&cursor=${encodeURIComponent(nextCursor)}`),
      usageContext
    )
    expect(second.status).toBe(200)
    expect(mocks.logs).toHaveBeenCalledTimes(2)
    for (const [, options] of mocks.logs.mock.calls) {
      expect(options.billingPeriod).toEqual({
        start: new Date('2026-08-01'),
        end: new Date('2026-09-01'),
      })
      expect(options.startDate).toBeUndefined()
      expect(options.endDate).toBeUndefined()
    }
  })

  it('keeps the first 30d window across clock advances and converts public source names', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
    admin()
    mocks.logs.mockResolvedValueOnce({
      logs: [
        {
          id: 'event-1',
          createdAt: '2026-09-01T00:00:00.000Z',
          source: 'workspace-chat',
          description: 'Model',
          cost: 0.001,
        },
      ],
      pagination: { hasMore: true, nextCursorKeys: ['2026-09-01T00:00:00.000Z', 'event-1'] },
    })
    const response = await events(request('usage/events?source=sim-chat&limit=1'), usageContext)
    expect(response.status).toBe(200)
    const first = await response.json()
    expect(first.data[0]).toMatchObject({ source: 'sim-chat', credits: 0, hasCost: true })
    const firstOptions = mocks.logs.mock.calls[0][1]
    expect(firstOptions.source).toEqual(['copilot', 'workspace-chat'])
    expect(firstOptions.keyset.sortOrder).toBe('desc')
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'))
    admin()
    const second = await events(
      request(
        `usage/events?source=sim-chat&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`
      ),
      usageContext
    )
    expect(second.status).toBe(200)
    const secondOptions = mocks.logs.mock.calls[1][1]
    expect(secondOptions.startDate).toEqual(firstOptions.startDate)
    expect(secondOptions.endDate).toEqual(firstOptions.endDate)
    expect(secondOptions.keyset.cursorKeys).toEqual(['2026-09-01T00:00:00.000Z', 'event-1'])
    expect(await second.json()).toEqual({ data: [], nextCursor: null })
    const changed = await events(
      request(
        `usage/events?source=workflow&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`
      ),
      usageContext
    )
    expect(changed.status).toBe(400)
    expect(mocks.logs).toHaveBeenCalledTimes(2)
  })
})
