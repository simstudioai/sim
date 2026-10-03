import type { OAuthAccessTokenPrincipal, Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import {
  billingUsageLogMock,
  billingUsageLogMockFns,
} from '@sim/testing/mocks/billing-usage-log.mock'
import {
  organizationMemberLimitsMock,
  organizationMemberLimitsMockFns,
} from '@sim/testing/mocks/organization-member-limits.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing/mocks/v2-route.mock'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  totals: vi.fn(),
  series: vi.fn(),
  breakdown: vi.fn(),
  entities: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/billing/core/billing', () => billingCoreMock)
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/billing/organizations/member-limits', () => organizationMemberLimitsMock)
vi.mock('@/lib/billing/core/usage-analytics-queries', () => ({
  readUsageTotals: mocks.totals,
  readUsageTimeSeries: mocks.series,
  readUsageGroups: mocks.breakdown,
  readUsageEntities: mocks.entities,
}))
vi.mock('@/lib/billing/core/usage-log', () => billingUsageLogMock)

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

const {
  mockGetOrgMemberUsageLimit,
  mockGetOrgMemberUsageForCurrentPeriod,
  mockSetOrgMemberUsageLimit,
  mockIsOrgMemberUsageLimitTarget,
} = organizationMemberLimitsMockFns
const { mockGetBillingEntityUsageLogs } = billingUsageLogMockFns
const { mockGetOrganizationSubscription } = billingCoreMockFns

const mockRecordAudit = auditMockFns.mockRecordAudit

const personal = createPersonalApiKeyPrincipal({ userId: 'actor', keyId: 'key' })
const oauth: OAuthAccessTokenPrincipal = {
  kind: 'oauth_access_token',
  userId: 'actor',
  tokenId: 'token',
  clientId: 'client',
  scopes: ['api:read', 'api:write'],
  expiresAt: new Date('2099-01-01'),
}
const context = createRouteContext({ organizationId: 'org', userId: 'external-user' })
const usageContext = createRouteContext({ organizationId: 'org' })
function authenticate(principal: Principal) {
  v2RouteMocks.authenticate.mockResolvedValue({
    principal,
    keyType: 'personal',
    rateLimitSubjectIds: ['key:key'],
    rateLimitSubscription: null,
  })
}
function request(path: string, body?: unknown) {
  return createMockRequest({
    method: body === undefined ? 'GET' : 'PATCH',
    url: `http://localhost/api/v2/organizations/org/${path}`,
    headers: {
      'x-api-key': 'key',
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
    },
    body,
  })
}
function admin() {
  queueTableRows(member, [{ role: 'admin' }])
}

beforeEach(() => {
  resetDbChainMock()
  setEnvFlags({ isHosted: true, isBillingEnabled: true })
  authenticate(personal)
  const admission = {
    allowed: true,
    remaining: 99,
    resetAt: new Date(Date.now() + 60_000),
    retryAfterMs: 0,
  }
  v2RouteMocks.preauthRate.mockResolvedValue(admission)
  v2RouteMocks.operationRate.mockResolvedValue(admission)
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(null)
  billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled.mockResolvedValue(true)
  mockGetOrganizationSubscription.mockResolvedValue({
    plan: 'enterprise',
    periodStart: new Date('2026-08-01'),
    periodEnd: new Date('2026-09-01'),
  })
  mockGetOrgMemberUsageLimit.mockResolvedValue(2)
  mockGetOrgMemberUsageForCurrentPeriod.mockResolvedValue(1)
  mockIsOrgMemberUsageLimitTarget.mockResolvedValue(true)
  mockSetOrgMemberUsageLimit.mockResolvedValue(undefined)
  mocks.totals.mockResolvedValue({ cost: 1 })
  mocks.series.mockResolvedValue([])
  mocks.breakdown.mockResolvedValue([])
  mocks.entities.mockResolvedValue(new Map())
  mockGetBillingEntityUsageLogs.mockResolvedValue({
    logs: [],
    pagination: { hasMore: false, nextCursorKeys: null },
  })
})
afterEach(() => vi.useRealTimers())
afterAll(resetEnvFlagsMock)

describe('organization credit-limit API', () => {
  it.each([personal, oauth])(
    'admits $kind and preserves external-user credit units and one semantic audit',
    async (principal) => {
      authenticate(principal)
      admin()
      admin()
      const response = await setLimit(
        request('members/external-user/usage-limit', { creditLimit: 400 }),
        context
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: { creditLimit: 400 } })
      expect(mockSetOrgMemberUsageLimit).toHaveBeenCalledWith(
        'org',
        'external-user',
        2,
        'actor',
        db
      )
      expect(mockIsOrgMemberUsageLimitTarget).toHaveBeenCalledWith('org', 'external-user')
      expect(mockRecordAudit).toHaveBeenCalledExactlyOnceWith(
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
    admin()
    expect(
      (await setLimit(request('members/external-user/usage-limit', { creditLimit }), context))
        .status
    ).toBe(200)
    expect(mockSetOrgMemberUsageLimit).toHaveBeenCalledWith(
      'org',
      'external-user',
      creditLimit,
      'actor',
      db
    )
  })

  it('rechecks the target after acquiring mutation locks', async () => {
    admin()
    admin()
    mockIsOrgMemberUsageLimitTarget.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const response = await setLimit(
      request('members/external-user/usage-limit', { creditLimit: 400 }),
      context
    )
    expect(response.status).toBe(404)
    expect(mockIsOrgMemberUsageLimitTarget).toHaveBeenLastCalledWith('org', 'external-user', {
      executor: db,
      forShare: true,
    })
    expect(mockSetOrgMemberUsageLimit).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('refuses an actor demoted while waiting for mutation locks', async () => {
    admin()
    queueTableRows(member, [{ role: 'member' }])
    const response = await setLimit(
      request('members/external-user/usage-limit', { creditLimit: 400 }),
      context
    )
    expect(response.status).toBe(403)
    expect(mockSetOrgMemberUsageLimit).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it.each([
    [personal, { disablePersonalApiKeys: true }],
    [oauth, { disableOAuthAppAccess: true }],
    [{ ...oauth, clientId: SIM_CLI_CLIENT_ID }, { disableCliAccess: true }],
  ] as const)(
    'rechecks $0.kind credential policy inside the mutation',
    async (principal, restriction) => {
      authenticate(principal)
      admin()
      admin()
      permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...DEFAULT_PERMISSION_GROUP_CONFIG,
          ...restriction,
        })
      const response = await setLimit(
        request('members/external-user/usage-limit', { creditLimit: 400 }),
        context
      )
      expect(response.status).toBe(403)
      expect(
        permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization
      ).toHaveBeenLastCalledWith('org', db)
      expect(mockSetOrgMemberUsageLimit).not.toHaveBeenCalled()
      expect(mockRecordAudit).not.toHaveBeenCalled()
    }
  )

  it('returns credits and the resolved organization billing interval', async () => {
    admin()
    const response = await getLimit(request('members/external-user/usage-limit'), context)
    expect(await response.json()).toEqual({
      data: { creditsUsed: 200, creditLimit: 400, billingInterval: 'month' },
    })
    expect(mockGetOrgMemberUsageForCurrentPeriod).toHaveBeenCalledWith(
      'org',
      'external-user',
      await mockGetOrganizationSubscription.mock.results[0].value
    )
  })

  it('does not require Usage Monitoring for hosted caps', async () => {
    admin()
    billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled.mockResolvedValue(false)
    expect((await getLimit(request('members/external-user/usage-limit'), context)).status).toBe(200)
    expect(billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled).not.toHaveBeenCalled()
  })

  it('preserves hosted-only admission before body validation', async () => {
    setEnvFlags({ isHosted: false })
    expect(
      (await setLimit(request('members/external-user/usage-limit', { invalid: true }), context))
        .status
    ).toBe(404)
    expect(mockSetOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('refuses reads for a user outside the organization before loading usage', async () => {
    admin()
    mockIsOrgMemberUsageLimitTarget.mockResolvedValue(false)
    const response = await getLimit(request('members/external-user/usage-limit'), context)
    expect(response.status).toBe(404)
    expect(mockGetOrgMemberUsageLimit).not.toHaveBeenCalled()
    expect(mockGetOrgMemberUsageForCurrentPeriod).not.toHaveBeenCalled()
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
  })

  it.each([10, null])(
    'refuses cap %s for a user outside the organization without mutation or audit',
    async (creditLimit) => {
      admin()
      mockIsOrgMemberUsageLimitTarget.mockResolvedValue(false)
      const response = await setLimit(
        request('members/external-user/usage-limit', { creditLimit }),
        context
      )
      expect(response.status).toBe(404)
      expect(mockSetOrgMemberUsageLimit).not.toHaveBeenCalled()
      expect(mockRecordAudit).not.toHaveBeenCalled()
    }
  )

  it('refuses read-only OAuth writes before target reads', async () => {
    authenticate({ ...oauth, scopes: ['api:read'] })
    expect(
      (await setLimit(request('members/external-user/usage-limit', { creditLimit: 10 }), context))
        .status
    ).toBe(403)
    expect(mockIsOrgMemberUsageLimitTarget).not.toHaveBeenCalled()
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
      expect(billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled).toHaveBeenCalledWith(
        'org',
        expect.any(Boolean)
      )
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
    mockGetOrganizationSubscription.mockResolvedValue({
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
    expect(billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled).not.toHaveBeenCalled()
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
    expect(billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled).not.toHaveBeenCalled()
  })

  it.each([
    [personal, 'disablePersonalApiKeys'],
    [oauth, 'disableOAuthAppAccess'],
    [{ ...oauth, clientId: SIM_CLI_CLIENT_ID }, 'disableCliAccess'],
  ] as const)('rechecks current credential policy %s / %s', async (principal, field) => {
    authenticate(principal)
    admin()
    permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      [field]: true,
    })
    expect((await summary(request('usage/summary'), usageContext)).status).toBe(403)
    expect(mocks.totals).not.toHaveBeenCalled()
  })

  it('retains the Usage Monitoring entitlement', async () => {
    admin()
    billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled.mockResolvedValue(false)
    expect((await events(request('usage/events'), usageContext)).status).toBe(403)
    expect(mockGetBillingEntityUsageLogs).not.toHaveBeenCalled()
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
    mockGetOrganizationSubscription.mockResolvedValue({
      plan: 'enterprise',
      periodStart: new Date('2020-01-01'),
      periodEnd: new Date('2026-01-01'),
    })
    expect(
      (await summary(request('usage/summary?preset=current-period'), usageContext)).status
    ).toBe(400)
    expect(mocks.totals).not.toHaveBeenCalled()
  })

  it('keeps member avatars out of the public breakdown', async () => {
    admin()
    mocks.breakdown.mockResolvedValue([{ key: 'user-1', cost: 1, events: 1 }])
    mocks.entities.mockResolvedValue(new Map([['user-1', { name: 'Ada', image: 'a.png' }]]))
    const response = await breakdown(request('usage/breakdown?dimension=member'), usageContext)
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.rows).toEqual([expect.objectContaining({ id: 'user-1', label: 'Ada' })])
    expect(data.rows[0]).not.toHaveProperty('image')
  })

  it('reports an oversized breakdown instead of presenting a partial total', async () => {
    admin()
    mocks.breakdown.mockResolvedValue(
      Array.from({ length: 10_001 }, (_, index) => ({ key: `user-${index}`, cost: 1, events: 1 }))
    )
    const response = await breakdown(request('usage/breakdown?dimension=member'), usageContext)
    expect(response.status).toBe(413)
    expect(mocks.breakdown).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: 'member', maxRows: 10_000 })
    )
  })
})

describe('organization usage event cursors', () => {
  const customQuery =
    'preset=custom&startDate=2026-03-08&endDate=2026-03-09&timezone=America%2FLos_Angeles&source=sim-chat&limit=1'
  const eventKeys = ['2026-03-09T12:00:00.000Z', 'event-1']

  async function firstCustomPage() {
    admin()
    mockGetBillingEntityUsageLogs.mockResolvedValueOnce({
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
    expect(mockGetBillingEntityUsageLogs).toHaveBeenCalledTimes(2)
    for (const [, options] of mockGetBillingEntityUsageLogs.mock.calls) {
      expect(options).toMatchObject({
        startDate: new Date('2026-03-08T08:00:00.000Z'),
        endDate: new Date('2026-03-10T07:00:00.000Z'),
        endDateExclusive: true,
      })
      expect(options.billingPeriod).toBeUndefined()
    }
    expect(mockGetBillingEntityUsageLogs.mock.calls[1][1].keyset.cursorKeys).toEqual(eventKeys)
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
    expect(mockGetBillingEntityUsageLogs).toHaveBeenCalledTimes(1)
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
    expect(mockGetBillingEntityUsageLogs).toHaveBeenCalledTimes(1)
  })

  it('keeps the first billing predicate after a subscription period changes', async () => {
    admin()
    mockGetBillingEntityUsageLogs.mockResolvedValueOnce({
      logs: [],
      pagination: { hasMore: true, nextCursorKeys: ['2026-08-15T00:00:00.000Z', 'event-1'] },
    })
    const first = await events(request('usage/events?preset=current-period'), usageContext)
    expect(first.status).toBe(200)
    const { nextCursor } = await first.json()
    mockGetOrganizationSubscription.mockResolvedValue({
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
    expect(mockGetBillingEntityUsageLogs).toHaveBeenCalledTimes(2)
    for (const [, options] of mockGetBillingEntityUsageLogs.mock.calls) {
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
    mockGetBillingEntityUsageLogs.mockResolvedValueOnce({
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
    const firstOptions = mockGetBillingEntityUsageLogs.mock.calls[0][1]
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
    const secondOptions = mockGetBillingEntityUsageLogs.mock.calls[1][1]
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
    expect(mockGetBillingEntityUsageLogs).toHaveBeenCalledTimes(2)
  })
})
