/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest, dbChainMock, dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetCreditBalanceForEntity,
  mockGetOrganizationBillingData,
  mockGetOrganizationSubscription,
  mockGetPersonalBillingSummary,
  mockResolveBillingInterval,
} = vi.hoisted(() => ({
  mockGetCreditBalanceForEntity: vi.fn(),
  mockGetOrganizationBillingData: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockGetPersonalBillingSummary: vi.fn(),
  mockResolveBillingInterval: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
  getPersonalBillingSummary: mockGetPersonalBillingSummary,
}))

vi.mock('@/lib/billing/core/organization', () => ({
  getOrganizationBillingData: mockGetOrganizationBillingData,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  resolveBillingInterval: mockResolveBillingInterval,
}))

vi.mock('@/lib/billing/credits/balance', () => ({
  getCreditBalanceForEntity: mockGetCreditBalanceForEntity,
}))

import { GET } from '@/app/api/billing/route'

const mockGetSession = authMockFns.mockGetSession

const PERSONAL_SUMMARY = {
  type: 'individual',
  plan: 'pro_6000',
  currentUsage: 8,
  usageLimit: 30,
  percentUsed: 26.67,
  isWarning: false,
  isExceeded: false,
  daysRemaining: 12,
  creditBalance: 4,
  billingInterval: 'month',
  isPaid: true,
  isPro: true,
  isTeam: false,
  isEnterprise: false,
  isOrgScoped: false,
  organizationId: null,
  status: 'active',
  seats: null,
  metadata: null,
  stripeSubscriptionId: 'sub_personal',
  periodEnd: new Date('2026-08-01T00:00:00.000Z'),
  cancelAtPeriodEnd: false,
  billingBlocked: false,
  billingBlockedReason: null,
  blockedByOrgOwner: false,
  usage: {
    current: 8,
    limit: 30,
    percentUsed: 26.67,
    isWarning: false,
    isExceeded: false,
    billingPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
    billingPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
    lastPeriodCost: 5,
    lastPeriodCopilotCost: 1,
    daysRemaining: 12,
    copilotCost: 2,
  },
} as const

const ACTIVE_ORG_SUBSCRIPTION = {
  id: 'org-subscription',
  referenceId: 'org-target',
  plan: 'team_25000',
  status: 'active',
  billingInterval: 'year',
  cancelAtPeriodEnd: true,
  periodStart: new Date('2026-07-01T00:00:00.000Z'),
  periodEnd: new Date('2026-08-01T00:00:00.000Z'),
} as const

const FREE_ORG_SUBSCRIPTION = {
  ...ACTIVE_ORG_SUBSCRIPTION,
  id: 'org-free-subscription',
  plan: 'free',
  billingInterval: 'month',
  cancelAtPeriodEnd: false,
} as const

interface OrganizationSubscriptionFixture {
  id: string
  referenceId: string
  plan: string
  status: string
  billingInterval: 'month' | 'year'
  cancelAtPeriodEnd: boolean
  periodStart: Date
  periodEnd: Date
}

const ACTIVE_ORG_BILLING = {
  organizationId: 'org-target',
  organizationName: 'Target organization',
  subscriptionPlan: 'team_25000',
  subscriptionStatus: 'active',
  totalSeats: 3,
  usedSeats: 2,
  seatsCount: 3,
  totalCurrentUsage: 21,
  totalUsageLimit: 125,
  minimumBillingAmount: 125,
  averageUsagePerMember: 10.5,
  billingPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
  billingPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
  members: [],
} as const

function request(query: string) {
  return createMockRequest('GET', undefined, {}, `http://localhost:3000/api/billing?${query}`)
}

function mockOrganizationDbRows({
  role = 'owner',
  latestSubscription = ACTIVE_ORG_SUBSCRIPTION,
  ownerId = 'owner-b',
  billingBlocked = true,
  billingBlockedReason = 'payment_failed',
  upgradeWorkspaceId = 'workspace-target',
}: {
  role?: 'owner' | 'admin' | 'member'
  latestSubscription?: OrganizationSubscriptionFixture | null
  ownerId?: string
  billingBlocked?: boolean
  billingBlockedReason?: 'payment_failed' | 'dispute' | null
  upgradeWorkspaceId?: string | null
} = {}) {
  dbChainMockFns.limit
    .mockResolvedValueOnce([{ role }])
    .mockResolvedValueOnce([{ id: 'org-target', name: 'Target organization' }])
    .mockResolvedValueOnce(latestSubscription ? [latestSubscription] : [])
    .mockResolvedValueOnce([{ userId: ownerId }])
    .mockResolvedValueOnce(upgradeWorkspaceId ? [{ id: upgradeWorkspaceId }] : [])
    .mockResolvedValueOnce([{ billingBlocked, billingBlockedReason }])
}

describe('GET /api/billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-a' } })
    mockGetPersonalBillingSummary.mockResolvedValue(PERSONAL_SUMMARY)
    mockGetOrganizationBillingData.mockResolvedValue(ACTIVE_ORG_BILLING)
    mockGetOrganizationSubscription.mockResolvedValue(ACTIVE_ORG_SUBSCRIPTION)
    mockGetCreditBalanceForEntity.mockResolvedValue(17)
    mockResolveBillingInterval.mockImplementation(
      (subscription: { billingInterval?: string | null } | null) =>
        subscription?.billingInterval === 'year' ? 'year' : 'month'
    )
  })

  it('keeps account billing personal even when an organization ID is supplied', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'personal-workspace' }])

    const response = await GET(request('context=user&id=org-a'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockGetPersonalBillingSummary).toHaveBeenCalledWith('viewer-a', dbChainMock.db)
    expect(mockGetOrganizationBillingData).not.toHaveBeenCalled()
    expect(body.data).toMatchObject({
      plan: 'pro_6000',
      type: 'individual',
      creditBalance: 4,
      billingBlocked: false,
      blockedByOrgOwner: false,
      upgradeWorkspaceId: 'personal-workspace',
    })
  })

  it('returns the exact organization payer fields for annual canceled plans', async () => {
    mockOrganizationDbRows()

    const response = await GET(request('context=organization&id=org-target'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockGetCreditBalanceForEntity).toHaveBeenCalledWith(
      'organization',
      'org-target',
      dbChainMock.db
    )
    expect(body.data).toMatchObject({
      organizationId: 'org-target',
      subscriptionState: 'active',
      hasSubscription: true,
      creditBalance: 17,
      billingInterval: 'year',
      cancelAtPeriodEnd: true,
      billingBlocked: true,
      billingBlockedReason: 'payment_failed',
      blockedByOrgOwner: true,
      upgradeWorkspaceId: 'workspace-target',
    })
  })

  it('rejects ordinary organization members before loading admin billing data', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ role: 'member' }])

    const response = await GET(request('context=organization&id=org-target'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied - organization admin permission is required',
    })
    expect(mockGetOrganizationBillingData).not.toHaveBeenCalled()
    expect(mockGetCreditBalanceForEntity).not.toHaveBeenCalled()
  })

  it('returns an explicit free state when the organization has no subscription', async () => {
    mockGetOrganizationBillingData.mockResolvedValue(null)
    mockGetOrganizationSubscription.mockResolvedValue(null)
    mockOrganizationDbRows({
      latestSubscription: null,
      ownerId: 'viewer-a',
      billingBlocked: false,
      billingBlockedReason: null,
    })

    const response = await GET(request('context=organization&id=org-target'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      subscriptionState: 'free',
      hasSubscription: false,
      subscriptionPlan: 'free',
      subscriptionStatus: null,
      creditBalance: 17,
      billingInterval: 'month',
      cancelAtPeriodEnd: false,
      billingBlocked: false,
    })
  })

  it('distinguishes an active free subscription from a paid active plan', async () => {
    mockGetOrganizationBillingData.mockResolvedValue(null)
    mockGetOrganizationSubscription.mockResolvedValue(FREE_ORG_SUBSCRIPTION)
    mockOrganizationDbRows({
      latestSubscription: FREE_ORG_SUBSCRIPTION,
      ownerId: 'viewer-a',
      billingBlocked: false,
      billingBlockedReason: null,
    })

    const response = await GET(request('context=organization&id=org-target'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      subscriptionState: 'free',
      hasSubscription: true,
      subscriptionPlan: 'free',
      subscriptionStatus: 'active',
      billingInterval: 'month',
      cancelAtPeriodEnd: false,
    })
  })

  it('retains the last target subscription as an explicit lapsed state', async () => {
    const lapsedSubscription = {
      ...ACTIVE_ORG_SUBSCRIPTION,
      status: 'canceled',
      cancelAtPeriodEnd: false,
    }
    mockGetOrganizationBillingData.mockResolvedValue(null)
    mockGetOrganizationSubscription.mockResolvedValue(null)
    mockOrganizationDbRows({ latestSubscription: lapsedSubscription })

    const response = await GET(request('context=organization&id=org-target'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      subscriptionState: 'lapsed',
      hasSubscription: true,
      subscriptionPlan: 'team_25000',
      subscriptionStatus: 'canceled',
      billingInterval: 'year',
      cancelAtPeriodEnd: false,
    })
  })
})
