import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetHighestPrioritySubscription,
  mockGetHighestPriorityPersonalSubscription,
  mockGetWorkspaceWithOwner,
  mockCheckEnterprisePlan,
  mockGetPlanTierCredits,
  mockHasUsableSubscriptionAccess,
  mockGetEffectiveBillingStatus,
  mockIsOrganizationBillingBlocked,
  mockCheckOrgPlan,
} = vi.hoisted(() => ({
  mockGetHighestPrioritySubscription: vi.fn(),
  mockGetHighestPriorityPersonalSubscription: vi.fn(),
  mockGetWorkspaceWithOwner: vi.fn(),
  mockCheckEnterprisePlan: vi.fn(),
  mockGetPlanTierCredits: vi.fn(),
  mockHasUsableSubscriptionAccess: vi.fn(),
  mockGetEffectiveBillingStatus: vi.fn(),
  mockIsOrganizationBillingBlocked: vi.fn(),
  mockCheckOrgPlan: vi.fn(),
}))

vi.mock('@/lib/billing/core/access', () => ({
  getEffectiveBillingStatus: mockGetEffectiveBillingStatus,
  isOrganizationBillingBlocked: mockIsOrganizationBillingBlocked,
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPriorityPersonalSubscription: mockGetHighestPriorityPersonalSubscription,
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  getPlanTierCredits: mockGetPlanTierCredits,
  isEnterprise: (plan: string | null | undefined) => plan === 'enterprise',
  isMaxTier: (plan: string | null | undefined) =>
    mockGetPlanTierCredits(plan) >= 25000 || plan === 'enterprise',
  isOrgPlan: (plan: string | null | undefined) =>
    plan === 'enterprise' || plan === 'team' || Boolean(plan?.startsWith('team_')),
  isPro: vi.fn(),
  isTeam: vi.fn(),
  sqlIsPaid: vi.fn(() => ({ type: 'sqlIsPaid' })),
}))

/** Mirrors the production sets exactly — a mock that widens them would let a gate regress unnoticed. */
vi.mock('@/lib/billing/subscriptions/utils', () => ({
  checkEnterprisePlan: mockCheckEnterprisePlan,
  checkOrgPlan: mockCheckOrgPlan,
  checkProPlan: vi.fn(),
  checkTeamPlan: vi.fn(),
  ENTITLED_SUBSCRIPTION_STATUSES: ['active', 'past_due'],
  hasUsableSubscriptionAccess: mockHasUsableSubscriptionAccess,
  USABLE_SUBSCRIPTION_STATUSES: ['active'],
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

import {
  getOrganizationCoverageForMember,
  getOrganizationIdForSubscriptionReference,
  hasPaidSubscription,
  hasWorkspaceLiveSyncAccess,
  hasWorkspaceSandboxAccess,
  hasWorkspaceSandboxRetentionAccess,
  isOrganizationGovernanceActive,
  isOrganizationOnEnterprisePlan,
  isWorkspaceOnEnterprisePlan,
  resolveOrganizationPlan,
  syncSubscriptionPlan,
} from '@/lib/billing/core/subscription'

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true, isHosted: true })
})

afterAll(resetEnvFlagsMock)

describe('hasPaidSubscription', () => {
  it('fails closed by default when the lookup errors', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(hasPaidSubscription('org-1')).resolves.toBe(true)
  })

  it('throws when requested so callers can retry instead of skipping cleanup', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(hasPaidSubscription('org-1', { onError: 'throw' })).rejects.toThrow(
      'db unavailable'
    )
  })
})

describe('syncSubscriptionPlan', () => {
  it('refuses a pro plan on an org-referenced subscription and returns the current plan', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'org-1' }])

    await expect(syncSubscriptionPlan('sub-1', 'team_6000', 'pro_6000', 'org-1')).resolves.toBe(
      'team_6000'
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('getOrganizationCoverageForMember', () => {
  it('reports unknown on lookup errors so callers fail closed', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(getOrganizationCoverageForMember('user-1')).resolves.toEqual({
      status: 'unknown',
    })
  })
})

describe('getOrganizationIdForSubscriptionReference', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  afterEach(resetDbChainMock)

  it.each(['owner', 'admin', 'member'])(
    'keeps a personal subscription personal when its user is an organization %s',
    async (role) => {
      queueTableRows(schemaMock.organization, [])
      queueTableRows(schemaMock.member, [{ organizationId: 'org-1', role }])

      await expect(getOrganizationIdForSubscriptionReference('user-1')).resolves.toBeNull()
      expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.member)
    }
  )

  it('propagates lookup errors instead of treating the subscription as personal', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(getOrganizationIdForSubscriptionReference('org-1')).rejects.toThrow(
      'db unavailable'
    )
  })
})

describe('isWorkspaceOnEnterprisePlan', () => {
  beforeEach(() => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'ws-1',
      billedAccountUserId: 'owner-1',
      organizationId: null,
    })
    mockHasUsableSubscriptionAccess.mockImplementation(
      (status: string | null, billingBlocked: boolean) => status === 'active' && !billingBlocked
    )
    mockGetEffectiveBillingStatus.mockResolvedValue({
      billingBlocked: false,
      billingBlockedReason: null,
      blockedByOrgOwner: false,
    })
  })

  // The organization branch has always required an `active`, unblocked payer via
  // `isOrganizationOnEnterprisePlan`. The personal branch used to skip both checks,
  // so a delinquent personal enterprise payer kept the feature while an org in the
  // identical state lost it. These two pin the branches to the same policy.
  it('denies a personal enterprise payer whose subscription is only past_due', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      referenceId: 'owner-1',
      plan: 'enterprise',
      status: 'past_due',
    })

    await expect(isWorkspaceOnEnterprisePlan('ws-1')).resolves.toBe(false)
  })

  it('denies a personal enterprise payer who is billing-blocked through their org owner', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      referenceId: 'owner-1',
      plan: 'enterprise',
      status: 'active',
    })
    mockGetEffectiveBillingStatus.mockResolvedValue({
      billingBlocked: true,
      billingBlockedReason: 'payment_failed',
      blockedByOrgOwner: true,
    })

    await expect(isWorkspaceOnEnterprisePlan('ws-1')).resolves.toBe(false)
    expect(mockGetEffectiveBillingStatus).toHaveBeenCalledWith('owner-1')
  })
})

describe('hasWorkspaceLiveSyncAccess', () => {
  beforeEach(() => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-host',
      billedAccountUserId: 'workspace-owner',
      organizationId: null,
    })
    mockHasUsableSubscriptionAccess.mockImplementation(
      (status: string | null, billingBlocked: boolean) => status === 'active' && !billingBlocked
    )
    mockGetEffectiveBillingStatus.mockResolvedValue({
      billingBlocked: false,
      billingBlockedReason: null,
      blockedByOrgOwner: false,
    })
  })

  it('denies a free workspace even when the actor has an unrelated paid plan', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue(null)
    mockGetHighestPrioritySubscription.mockResolvedValue({
      referenceId: 'paid-external-actor',
      plan: 'enterprise',
      status: 'active',
    })

    await expect(hasWorkspaceLiveSyncAccess('workspace-host')).resolves.toBe(false)
    expect(mockGetHighestPriorityPersonalSubscription).toHaveBeenCalledWith('workspace-owner')
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  // The payer's own row is clean; only their membership in a delinquent org
  // blocks them. Reading `userStats.billingBlocked` directly would let this
  // through whenever `blockOrgMembers`' fan-out is stale — a member who joined
  // after the block, or whose row a sibling org's unblock already cleared.
  it('denies a paid personal payer who is blocked by their org owner', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      referenceId: 'workspace-owner',
      plan: 'pro_25000',
      status: 'active',
    })
    mockGetPlanTierCredits.mockReturnValue(25000)
    mockGetEffectiveBillingStatus.mockResolvedValue({
      billingBlocked: true,
      billingBlockedReason: 'payment_failed',
      blockedByOrgOwner: true,
    })

    await expect(hasWorkspaceLiveSyncAccess('workspace-host')).resolves.toBe(false)
    expect(mockGetEffectiveBillingStatus).toHaveBeenCalledWith('workspace-owner')
  })
})

describe('hasWorkspaceSandboxAccess', () => {
  beforeEach(() => {
    setEnvFlags({
      isBillingEnabled: true,
      isHosted: true,
      isSandboxDeploymentEntitled: false,
      isSandboxesEnabled: true,
    })
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-host',
      billedAccountUserId: 'workspace-owner',
      organizationId: null,
    })
    mockHasUsableSubscriptionAccess.mockImplementation(
      (status: string | null, billingBlocked: boolean) => status === 'active' && !billingBlocked
    )
    mockGetEffectiveBillingStatus.mockResolvedValue({
      billingBlocked: false,
      billingBlockedReason: null,
      blockedByOrgOwner: false,
    })
  })

  it('fails closed before resolving a payer when the remote feature is unavailable', async () => {
    setEnvFlags({ isSandboxesEnabled: false })

    await expect(hasWorkspaceSandboxAccess('workspace-host')).resolves.toBe(false)
    expect(mockGetWorkspaceWithOwner).not.toHaveBeenCalled()
    expect(mockGetHighestPriorityPersonalSubscription).not.toHaveBeenCalled()
  })

  it('denies a sub-Max payer on a billing-enabled deployment', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      referenceId: 'workspace-owner',
      plan: 'pro_6000',
      status: 'active',
    })
    mockGetPlanTierCredits.mockReturnValue(6000)

    await expect(hasWorkspaceSandboxAccess('workspace-host')).resolves.toBe(false)
  })

  it('requires an Enterprise or Sandbox deployment entitlement when billing is disabled', async () => {
    setEnvFlags({
      isBillingEnabled: false,
      isSandboxDeploymentEntitled: false,
      isSandboxesEnabled: false,
    })

    await expect(hasWorkspaceSandboxAccess('workspace-host')).resolves.toBe(false)

    setEnvFlags({
      isSandboxDeploymentEntitled: true,
      isSandboxesEnabled: true,
    })

    await expect(hasWorkspaceSandboxAccess('workspace-host')).resolves.toBe(true)
    expect(mockGetWorkspaceWithOwner).not.toHaveBeenCalled()
  })
})

describe('hasWorkspaceSandboxRetentionAccess', () => {
  beforeEach(() => {
    setEnvFlags({
      isBillingEnabled: true,
      isHosted: true,
      isSandboxDeploymentEntitled: false,
      isSandboxesEnabled: true,
    })
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-host',
      billedAccountUserId: 'workspace-owner',
      organizationId: null,
    })
  })

  /**
   * The point of the retention intent: a card that failed last night must not
   * turn every deployed Function block into an outage this morning.
   */
  it('keeps a past_due Max payer running without consulting usability', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      referenceId: 'workspace-owner',
      plan: 'pro_25000',
      status: 'past_due',
    })
    mockGetPlanTierCredits.mockReturnValue(25000)

    await expect(hasWorkspaceSandboxRetentionAccess('workspace-host')).resolves.toBe(true)
    expect(mockHasUsableSubscriptionAccess).not.toHaveBeenCalled()
    expect(mockGetEffectiveBillingStatus).not.toHaveBeenCalled()
  })

  it('fails a payer that dropped below the Max tier', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      referenceId: 'workspace-owner',
      plan: 'pro_6000',
      status: 'active',
    })
    mockGetPlanTierCredits.mockReturnValue(6000)

    await expect(hasWorkspaceSandboxRetentionAccess('workspace-host')).resolves.toBe(false)
  })

  it('fails a payer with no entitled subscription left', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue(null)

    await expect(hasWorkspaceSandboxRetentionAccess('workspace-host')).resolves.toBe(false)
  })

  it('fails closed before resolving a payer when the remote feature is unavailable', async () => {
    setEnvFlags({ isSandboxesEnabled: false })

    await expect(hasWorkspaceSandboxRetentionAccess('workspace-host')).resolves.toBe(false)
    expect(mockGetWorkspaceWithOwner).not.toHaveBeenCalled()
  })

  /**
   * A one-shot gate may read an outage as a lapse; a cached gate must not, or
   * it would hold every Function block shut for a whole TTL. The caller asks,
   * and the ask is forwarded to the reader so the failure is not swallowed
   * one level down.
   */
  it('reports a read failure as a lapse unless asked to throw', async () => {
    mockGetHighestPriorityPersonalSubscription.mockRejectedValue(new Error('billing down'))

    await expect(hasWorkspaceSandboxRetentionAccess('workspace-host')).resolves.toBe(false)
    await expect(
      hasWorkspaceSandboxRetentionAccess('workspace-host', { onError: 'throw' })
    ).rejects.toThrow('billing down')
    expect(mockGetHighestPriorityPersonalSubscription).toHaveBeenLastCalledWith('workspace-owner', {
      onError: 'throw',
    })
  })
})

describe('resolveOrganizationPlan', () => {
  const ORGANIZATION_ID = 'org-1'

  beforeEach(() => {
    /** An earlier describe leaves billing disabled, which short-circuits this gate to true. */
    setEnvFlags({ isBillingEnabled: true, isHosted: true })
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockCheckOrgPlan.mockReturnValue(true)
  })

  it('rejects a billing-blocked organization without consulting the plan', async () => {
    mockIsOrganizationBillingBlocked.mockResolvedValue(true)
    dbChainMockFns.limit.mockResolvedValue([{ plan: 'enterprise', status: 'active' }])

    await expect(resolveOrganizationPlan(ORGANIZATION_ID)).resolves.toBe(false)
    expect(mockCheckOrgPlan).not.toHaveBeenCalled()
  })

  /**
   * The subscription read soft-fails to `null` on its own, so without the
   * option threaded through it an outage arrives as an ordinary "no usable
   * subscription" and returns a successful `false`. A caller that caches the
   * answer would then record the outage as a plan lapse for its whole TTL.
   */
  it('propagates a failed subscription read instead of reporting it as no plan', async () => {
    dbChainMockFns.limit.mockRejectedValue(new Error('billing database unavailable'))

    await expect(resolveOrganizationPlan(ORGANIZATION_ID)).resolves.toBe(false)
    await expect(resolveOrganizationPlan(ORGANIZATION_ID, { onError: 'throw' })).rejects.toThrow(
      'billing database unavailable'
    )
  })
})

describe('isOrganizationGovernanceActive', () => {
  const ORGANIZATION_ID = 'org-governed'

  beforeEach(() => {
    setEnvFlags({ isBillingEnabled: true, isHosted: true })
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockCheckEnterprisePlan.mockReturnValue(true)
  })

  /**
   * The bug this exists for: an unentitled organization resolves to `config: null`, which denies
   * nothing, so treating a failing card as a lapsed plan lifted every restriction the organization
   * had configured — silently, for the whole dunning window.
   */
  it('keeps governing through a past-due subscription', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ plan: 'enterprise', status: 'past_due' }])

    await expect(isOrganizationGovernanceActive(ORGANIZATION_ID)).resolves.toBe(true)
    /**
     * Asserted on the filter, not the returned row: the chain mock answers whatever is queued
     * regardless of the where clause, so only the status set proves a past-due subscription is
     * actually read. The feature gate below deliberately narrows to `active`.
     */
    expect(vi.mocked(inArray)).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['active', 'past_due'])
    )
  })

  it('reads a narrower status set than the feature gate does', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ plan: 'enterprise', status: 'active' }])

    await isOrganizationOnEnterprisePlan('org-feature-gate')
    expect(vi.mocked(inArray)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['past_due'])
    )
  })

  /** A suspension is a billing state, not a decision to stop governing. */
  it('keeps governing a billing-blocked organization', async () => {
    mockIsOrganizationBillingBlocked.mockResolvedValue(true)
    dbChainMockFns.limit.mockResolvedValue([{ plan: 'enterprise', status: 'past_due' }])

    await expect(isOrganizationGovernanceActive(ORGANIZATION_ID)).resolves.toBe(true)
  })

  /** A read failure must never read as "no restrictions". */
  it('propagates a failed subscription read rather than answering false', async () => {
    dbChainMockFns.limit.mockRejectedValue(new Error('billing database unavailable'))

    await expect(isOrganizationGovernanceActive(ORGANIZATION_ID)).rejects.toThrow(
      'billing database unavailable'
    )
  })
})

describe('isOrganizationOnEnterprisePlan', () => {
  const ORGANIZATION_ID = 'org-1'

  beforeEach(() => {
    /** An earlier describe leaves billing disabled, which short-circuits this gate to true. */
    setEnvFlags({ isBillingEnabled: true, isHosted: true })
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockCheckEnterprisePlan.mockReturnValue(true)
  })

  /**
   * The lenient default is what every feature gate reads — a hidden button is
   * the worst outcome there — so a read failure must keep resolving `false`
   * rather than starting to reject through those callers.
   */
  it('keeps failing closed to false for the default policy', async () => {
    dbChainMockFns.limit.mockRejectedValue(new Error('billing database unavailable'))

    await expect(isOrganizationOnEnterprisePlan(ORGANIZATION_ID)).resolves.toBe(false)
    await expect(isOrganizationOnEnterprisePlan(ORGANIZATION_ID, 'return-false')).resolves.toBe(
      false
    )
  })

  /**
   * The subscription read soft-fails to `null` on its own, so without the
   * policy threaded through it an outage arrives as an ordinary "no usable
   * subscription" and returns a successful `false`. For Access Control that
   * `false` means `config: null` — every capability allowed — so it has to
   * propagate.
   */
  it('propagates a failed subscription read when the caller asked to throw', async () => {
    dbChainMockFns.limit.mockRejectedValue(new Error('billing database unavailable'))

    await expect(isOrganizationOnEnterprisePlan(ORGANIZATION_ID, 'throw')).rejects.toThrow(
      'billing database unavailable'
    )
  })
})
