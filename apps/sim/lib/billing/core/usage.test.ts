/**
 * Tests for getUserUsageLimit.
 *
 * Org-scoped members carry a null `currentUsageLimit` by design, so a user
 * whose subscription stops being org-scoped without a resync is left null.
 * The limit read must self-heal that state to the plan/free base plus prepaid
 * balance instead of failing closed and blocking every execution.
 *
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

afterAll(() => {
  resetDbChainMock()
})

const {
  mockGetFreeTierLimit,
  mockGetHighestPrioritySubscription,
  mockGetPerUserMinimumLimit,
  mockHasPaidSubscriptionStatus,
  mockIsOrgScopedSubscription,
} = vi.hoisted(() => ({
  mockGetFreeTierLimit: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockGetPerUserMinimumLimit: vi.fn(),
  mockHasPaidSubscriptionStatus: vi.fn(),
  mockIsOrgScopedSubscription: vi.fn(),
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  canEditUsageLimit: vi.fn(),
  getFreeTierLimit: mockGetFreeTierLimit,
  getPerUserMinimumLimit: mockGetPerUserMinimumLimit,
  getPlanPricing: vi.fn(() => ({ basePrice: 20 })),
  hasPaidSubscriptionStatus: mockHasPaidSubscriptionStatus,
  hasUsableSubscriptionAccess: vi.fn(),
  isOrgScopedSubscription: mockIsOrgScopedSubscription,
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/core/access', () => ({
  getEffectiveBillingStatus: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  getBillingPeriodUsageCost: vi.fn(),
}))

vi.mock('@/lib/billing/credits/daily-refresh', () => ({
  computeDailyRefreshConsumed: vi.fn(),
  getOrgMemberRefreshBounds: vi.fn(),
}))

const {
  mockGetEmailSubject,
  mockGetLimitEmailSubject,
  mockRenderCreditsExhausted,
  mockRenderFreeTierUpgrade,
  mockRenderUsageLimitReached,
  mockRenderUsageThreshold,
  mockSendEmail,
  mockGetEmailPreferences,
  mockIsOrgAdminRole,
} = vi.hoisted(() => ({
  mockGetEmailSubject: vi.fn(() => 'Subject'),
  mockGetLimitEmailSubject: vi.fn(() => 'Limit subject'),
  mockRenderCreditsExhausted: vi.fn(() => Promise.resolve('<html>free</html>')),
  mockRenderFreeTierUpgrade: vi.fn(() => Promise.resolve('<html>nudge</html>')),
  mockRenderUsageLimitReached: vi.fn(() => Promise.resolve('<html>reached</html>')),
  mockRenderUsageThreshold: vi.fn(() => Promise.resolve('<html>warning</html>')),
  mockSendEmail: vi.fn(() => Promise.resolve({ success: true })),
  mockGetEmailPreferences: vi.fn(() => Promise.resolve(null as unknown)),
  mockIsOrgAdminRole: vi.fn(() => true),
}))

vi.mock('@/components/emails', () => ({
  getEmailSubject: mockGetEmailSubject,
  getLimitEmailSubject: mockGetLimitEmailSubject,
  renderCreditsExhaustedEmail: mockRenderCreditsExhausted,
  renderFreeTierUpgradeEmail: mockRenderFreeTierUpgrade,
  renderUsageLimitReachedEmail: mockRenderUsageLimitReached,
  renderUsageThresholdEmail: mockRenderUsageThreshold,
}))

vi.mock('@/lib/messaging/email/mailer', () => ({
  sendEmail: mockSendEmail,
}))

vi.mock('@/lib/messaging/email/unsubscribe', () => ({
  getEmailPreferences: mockGetEmailPreferences,
}))

vi.mock('@sim/platform-authz/workspace', () => ({ isOrgAdminRole: mockIsOrgAdminRole }))

import {
  getUserUsageLimit,
  maybeSendUsageThresholdEmail,
  syncUsageLimitsFromSubscription,
} from '@/lib/billing/core/usage'

const PRO_SUBSCRIPTION = {
  id: 'sub-1',
  plan: 'pro',
  status: 'active',
  referenceId: 'user-1',
  seats: 1,
  periodStart: null,
  periodEnd: null,
} as never

describe('getUserUsageLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsOrgScopedSubscription.mockReturnValue(false)
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
  })

  it('returns the stored limit when set', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: '25' }])

    const limit = await getUserUsageLimit('user-1', null)

    expect(limit).toBe(25)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('throws when no userStats row exists', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(getUserUsageLimit('user-1', null)).rejects.toThrow('No user stats record found')
  })

  it('heals a null limit to the free-tier default for free users', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { currentUsageLimit: null, creditBalance: '0.006' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ currentUsageLimit: '10.006' }])
    mockGetFreeTierLimit.mockReturnValue(10)

    const limit = await getUserUsageLimit('user-1', null)

    expect(limit).toBe(10.006)
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      currentUsageLimit: '10.006',
      usageLimitUpdatedAt: expect.any(Date),
    })
    const [condition] = dbChainMockFns.where.mock.calls.at(-1) ?? []
    expect(condition).toMatchObject({
      type: 'and',
      conditions: [{ type: 'eq', right: 'user-1' }, { type: 'isNull' }],
    })
  })

  it('heals a null limit to the plan minimum for paid personal subscriptions', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: null, creditBalance: '1.25' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ currentUsageLimit: '41.25' }])
    mockHasPaidSubscriptionStatus.mockReturnValue(true)
    mockGetPerUserMinimumLimit.mockReturnValue(40)

    const limit = await getUserUsageLimit('user-1', PRO_SUBSCRIPTION)

    expect(limit).toBe(41.25)
    expect(mockGetPerUserMinimumLimit).toHaveBeenCalledWith(PRO_SUBSCRIPTION)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      currentUsageLimit: '41.25',
      usageLimitUpdatedAt: expect.any(Date),
    })
  })

  it('returns a concurrently written limit when the guarded heal matches no rows', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: null }])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: '30' }])
    mockGetFreeTierLimit.mockReturnValue(10)

    const limit = await getUserUsageLimit('user-1', null)

    expect(limit).toBe(30)
  })

  it('still returns the fallback when the heal write fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: null }])
    dbChainMockFns.returning.mockRejectedValueOnce(new Error('connection lost'))
    mockGetFreeTierLimit.mockReturnValue(10)

    await expect(getUserUsageLimit('user-1', null)).resolves.toBe(10)
  })
})

describe('syncUsageLimitsFromSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsOrgScopedSubscription.mockReturnValue(false)
  })

  it('raises a paid personal limit to plan base plus the exact prepaid balance', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue(PRO_SUBSCRIPTION)
    mockGetPerUserMinimumLimit.mockReturnValue(40)
    dbChainMockFns.limit.mockResolvedValueOnce([
      { currentUsageLimit: '40', creditBalance: '0.005' },
    ])

    await syncUsageLimitsFromSubscription('user-1')

    const update = dbChainMockFns.set.mock.calls[0]?.[0]
    const expression = JSON.stringify(update?.currentUsageLimit)
    expect(expression).toContain('greatest')
    expect(expression).toContain('creditBalance')
    expect(expression).not.toContain('0.005')
  })

  it('restores free-tier base plus prepaid after a downgrade or org departure', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
    mockGetPerUserMinimumLimit.mockReturnValue(10)
    dbChainMockFns.limit.mockResolvedValueOnce([
      { currentUsageLimit: null, creditBalance: '0.006' },
    ])

    await syncUsageLimitsFromSubscription('user-1')

    const update = dbChainMockFns.set.mock.calls[0]?.[0]
    const expression = JSON.stringify(update?.currentUsageLimit)
    expect(expression).toContain('creditBalance')
    expect(expression).not.toContain('greatest')
    expect(expression).not.toContain('0.006')
  })

  it('does not retain a higher paid custom cap after downgrade to free', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
    mockGetPerUserMinimumLimit.mockReturnValue(10)
    dbChainMockFns.limit.mockResolvedValueOnce([
      { currentUsageLimit: '100', creditBalance: '0.006' },
    ])

    await syncUsageLimitsFromSubscription('user-1')

    const update = dbChainMockFns.set.mock.calls[0]?.[0]
    const expression = JSON.stringify(update?.currentUsageLimit)
    expect(expression).toContain('creditBalance')
    expect(expression).not.toContain('greatest')
    expect(expression).not.toContain('100')
  })

  it('preserves a higher custom personal limit', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue(PRO_SUBSCRIPTION)
    mockGetPerUserMinimumLimit.mockReturnValue(40)
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: '50', creditBalance: '1' }])

    await syncUsageLimitsFromSubscription('user-1')

    const update = dbChainMockFns.set.mock.calls[0]?.[0]
    const expression = JSON.stringify(update?.currentUsageLimit)
    expect(expression).toContain('greatest')
    expect(expression).toContain('creditBalance')
  })
})

describe('maybeSendUsageThresholdEmail', () => {
  const paidUser = {
    scope: 'user' as const,
    planName: 'Pro',
    userId: 'user-1',
    userEmail: 'user-1@example.com',
    userName: 'Ada',
    workspaceId: 'ws-1',
    limit: 20,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
    mockGetEmailPreferences.mockResolvedValue(null)
    mockIsOrgAdminRole.mockReturnValue(true)
  })

  afterAll(() => {
    resetEnvFlagsMock()
  })

  it('emails a paid personal account at 100% with the raise-your-limit template', async () => {
    await maybeSendUsageThresholdEmail({
      ...paidUser,
      percentBefore: 90,
      percentAfter: 100,
      currentUsageAfter: 20,
    })

    expect(mockRenderUsageLimitReached).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'user', planName: 'Pro' })
    )
    expect(mockRenderCreditsExhausted).not.toHaveBeenCalled()
    expect(mockGetLimitEmailSubject).toHaveBeenCalledWith('credits', 'reached')
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('links a paid personal account to billing settings, not the upgrade page', async () => {
    await maybeSendUsageThresholdEmail({
      ...paidUser,
      percentBefore: 90,
      percentAfter: 100,
      currentUsageAfter: 20,
    })

    const props = mockRenderUsageLimitReached.mock.calls[0]?.[0] as { ctaLink: string }
    expect(props.ctaLink).toContain('/account/settings/billing')
  })

  it('fans out to org admins at 100% and skips non-admin members', async () => {
    mockIsOrgAdminRole.mockImplementation((role: unknown) => role === 'admin')
    queueTableRows(schemaMock.member, [
      { email: 'admin@example.com', name: 'Admin', enabled: null, role: 'admin' },
      { email: 'member@example.com', name: 'Member', enabled: null, role: 'member' },
    ])

    await maybeSendUsageThresholdEmail({
      scope: 'organization',
      planName: 'Team',
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      percentBefore: 95,
      percentAfter: 100,
      currentUsageAfter: 500,
      limit: 500,
    })

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@example.com', emailType: 'notifications' })
    )
    expect(mockRenderUsageLimitReached).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'organization' })
    )
  })

  it('still sends the free-tier template to a free personal account at 100%', async () => {
    await maybeSendUsageThresholdEmail({
      ...paidUser,
      planName: 'Free',
      percentBefore: 90,
      percentAfter: 100,
      currentUsageAfter: 10,
      limit: 10,
    })

    expect(mockRenderCreditsExhausted).toHaveBeenCalledTimes(1)
    expect(mockRenderUsageLimitReached).not.toHaveBeenCalled()
    expect(mockGetEmailSubject).toHaveBeenCalledWith('free-tier-exhausted')
  })

  it('sends only the reached email when one execution crosses 80 and 100 together', async () => {
    await maybeSendUsageThresholdEmail({
      ...paidUser,
      percentBefore: 70,
      percentAfter: 100,
      currentUsageAfter: 20,
    })

    expect(mockRenderUsageThreshold).not.toHaveBeenCalled()
    expect(mockRenderUsageLimitReached).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('still sends the 80% warning to a paid account that has not reached 100%', async () => {
    await maybeSendUsageThresholdEmail({
      ...paidUser,
      percentBefore: 70,
      percentAfter: 85,
      currentUsageAfter: 17,
    })

    expect(mockRenderUsageThreshold).toHaveBeenCalledTimes(1)
    expect(mockRenderUsageLimitReached).not.toHaveBeenCalled()
  })

  it('does not send when the recipient unsubscribed from notifications', async () => {
    mockGetEmailPreferences.mockResolvedValue({ unsubscribeNotifications: true })

    await maybeSendUsageThresholdEmail({
      ...paidUser,
      percentBefore: 90,
      percentAfter: 100,
      currentUsageAfter: 20,
    })

    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('does not send when the per-user billing toggle is off', async () => {
    queueTableRows(schemaMock.settings, [{ enabled: false }])

    await maybeSendUsageThresholdEmail({
      ...paidUser,
      percentBefore: 90,
      percentAfter: 100,
      currentUsageAfter: 20,
    })

    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('does nothing when no threshold is crossed', async () => {
    await maybeSendUsageThresholdEmail({
      ...paidUser,
      percentBefore: 50,
      percentAfter: 60,
      currentUsageAfter: 12,
    })

    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
