/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFlags,
  mockCheckBillingBlocked,
  mockCheckBillingEntityBlocked,
  mockCheckOrganizationMemberUsageLimit,
  mockCheckUsageStatus,
  mockGetHighestPriorityPersonalSubscription,
  mockGetOrganizationSubscription,
  mockLimit,
} = vi.hoisted(() => ({
  mockFlags: { isBillingEnabled: true, isHosted: true },
  mockCheckBillingBlocked: vi.fn(),
  mockCheckBillingEntityBlocked: vi.fn(),
  mockCheckOrganizationMemberUsageLimit: vi.fn(),
  mockCheckUsageStatus: vi.fn(),
  mockGetHighestPriorityPersonalSubscription: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockLimit: vi.fn(),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return mockFlags.isBillingEnabled
  },
  get isHosted() {
    return mockFlags.isHosted
  },
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockLimit,
        })),
      })),
    })),
  },
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkBillingBlocked: mockCheckBillingBlocked,
  checkBillingEntityBlocked: mockCheckBillingEntityBlocked,
  checkOrganizationMemberUsageLimit: mockCheckOrganizationMemberUsageLimit,
  checkUsageStatus: mockCheckUsageStatus,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPriorityPersonalSubscription: mockGetHighestPriorityPersonalSubscription,
}))

import {
  assertBillingAttributionSnapshot,
  billingAttributionsEqual,
  checkAttributedBillingBlocks,
  checkAttributedUsageLimits,
  createAttributedBillingRequestEnvelope,
  requireAccountBillingDecisionHeader,
  requireBillingAttributionHeader,
  requireBillingRequestIdHeader,
  resolveBillingAttribution,
  resolveLegacyV0BillingAttribution,
  resolveSystemBillingAttribution,
  serializeAccountBillingDecisionHeader,
  serializeBillingAttributionHeader,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'

const ORG_SUBSCRIPTION = {
  id: 'sub-org-b',
  plan: 'team_25000',
  referenceId: 'org-b',
  seats: 4,
  status: 'active',
  periodStart: new Date('2026-07-01T00:00:00.000Z'),
  periodEnd: new Date('2026-08-01T00:00:00.000Z'),
}

describe('resolveBillingAttribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckBillingBlocked.mockResolvedValue({ blocked: false })
    mockCheckBillingEntityBlocked.mockResolvedValue({ blocked: false })
    mockCheckUsageStatus.mockResolvedValue({
      currentUsage: 10,
      isExceeded: false,
      limit: 100,
      organizationId: 'org-b',
      percentUsed: 10,
      isWarning: false,
      scope: 'organization',
    })
    mockCheckOrganizationMemberUsageLimit.mockResolvedValue({
      currentUsage: 5,
      isExceeded: false,
      limit: null,
    })
  })

  it('bills the workspace organization while retaining an external session actor', async () => {
    mockLimit.mockResolvedValue([
      {
        billedAccountUserId: 'owner-b',
        organizationId: 'org-b',
      },
    ])
    mockGetOrganizationSubscription.mockResolvedValue(ORG_SUBSCRIPTION)

    const attribution = await resolveBillingAttribution({
      actorUserId: 'external-a',
      workspaceId: 'workspace-b',
    })

    expect(attribution).toEqual({
      actorUserId: 'external-a',
      billedAccountUserId: 'owner-b',
      billingEntity: { id: 'org-b', type: 'organization' },
      billingPeriod: {
        end: '2026-08-01T00:00:00.000Z',
        start: '2026-07-01T00:00:00.000Z',
      },
      organizationId: 'org-b',
      payerSubscription: {
        id: 'sub-org-b',
        periodEnd: '2026-08-01T00:00:00.000Z',
        periodStart: '2026-07-01T00:00:00.000Z',
        plan: 'team_25000',
        referenceId: 'org-b',
        seats: 4,
        status: 'active',
      },
      workspaceId: 'workspace-b',
    })
    expect(mockGetOrganizationSubscription).toHaveBeenCalledWith('org-b', {
      onError: 'throw',
    })
    expect(mockGetHighestPriorityPersonalSubscription).not.toHaveBeenCalled()
    expect(Object.isFrozen(attribution)).toBe(true)
    expect(Object.isFrozen(attribution.billingEntity)).toBe(true)
  })

  it('resolves the system actor and payer from one workspace row', async () => {
    mockLimit.mockResolvedValue([
      {
        billedAccountUserId: 'owner-b',
        organizationId: 'org-b',
      },
    ])
    mockGetOrganizationSubscription.mockResolvedValue(ORG_SUBSCRIPTION)

    const attribution = await resolveSystemBillingAttribution('workspace-b')

    expect(attribution).toMatchObject({
      actorUserId: 'owner-b',
      billedAccountUserId: 'owner-b',
      billingEntity: { id: 'org-b', type: 'organization' },
      organizationId: 'org-b',
      workspaceId: 'workspace-b',
    })
    expect(mockLimit).toHaveBeenCalledTimes(1)
  })

  it('uses the workspace organization reference even when its billed owner has other memberships', async () => {
    mockLimit.mockResolvedValue([
      {
        billedAccountUserId: 'multi-org-owner',
        organizationId: 'org-b',
      },
    ])
    mockGetOrganizationSubscription.mockResolvedValue(ORG_SUBSCRIPTION)

    const attribution = await resolveBillingAttribution({
      actorUserId: 'multi-org-owner',
      workspaceId: 'workspace-b',
    })

    expect(attribution.billingEntity).toEqual({ type: 'organization', id: 'org-b' })
    expect(mockGetOrganizationSubscription).toHaveBeenCalledWith('org-b', {
      onError: 'throw',
    })
    expect(mockGetHighestPriorityPersonalSubscription).not.toHaveBeenCalled()
  })

  it('bills a personal workspace billed account without changing the API-key actor', async () => {
    mockLimit.mockResolvedValue([
      {
        billedAccountUserId: 'personal-owner',
        organizationId: null,
      },
    ])
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      id: 'sub-personal',
      plan: 'pro_100',
      referenceId: 'personal-owner',
      seats: 1,
      status: 'active',
      periodStart: new Date('2026-07-03T00:00:00.000Z'),
      periodEnd: new Date('2026-08-03T00:00:00.000Z'),
    })

    const attribution = await resolveBillingAttribution({
      actorUserId: 'personal-api-key-owner',
      workspaceId: 'personal-workspace',
    })

    expect(attribution.actorUserId).toBe('personal-api-key-owner')
    expect(attribution.billedAccountUserId).toBe('personal-owner')
    expect(attribution.billingEntity).toEqual({ type: 'user', id: 'personal-owner' })
    expect(mockGetHighestPriorityPersonalSubscription).toHaveBeenCalledWith('personal-owner', {
      onError: 'throw',
    })
  })

  it('retains the exact personal payer when it has no subscription', async () => {
    mockLimit.mockResolvedValue([
      {
        billedAccountUserId: 'personal-owner',
        organizationId: null,
      },
    ])
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue(null)

    const attribution = await resolveBillingAttribution({
      actorUserId: 'external-actor',
      workspaceId: 'personal-workspace',
    })

    expect(attribution).toMatchObject({
      actorUserId: 'external-actor',
      billedAccountUserId: 'personal-owner',
      billingEntity: { type: 'user', id: 'personal-owner' },
      organizationId: null,
      payerSubscription: null,
    })
  })

  it('serializes only the payer fields needed by later billing gates', async () => {
    mockLimit.mockResolvedValue([
      {
        billedAccountUserId: 'owner-b',
        organizationId: 'org-b',
      },
    ])
    mockGetOrganizationSubscription.mockResolvedValue({
      ...ORG_SUBSCRIPTION,
      metadata: { secret: 'must-not-cross-boundary' },
      stripeSubscriptionId: 'stripe-subscription',
    })

    const attribution = await resolveBillingAttribution({
      actorUserId: 'actor-a',
      workspaceId: 'workspace-b',
    })

    expect(attribution.payerSubscription).toEqual({
      id: 'sub-org-b',
      periodEnd: '2026-08-01T00:00:00.000Z',
      periodStart: '2026-07-01T00:00:00.000Z',
      plan: 'team_25000',
      referenceId: 'org-b',
      seats: 4,
      status: 'active',
    })
    expect(JSON.stringify(attribution)).not.toContain('must-not-cross-boundary')
    expect(JSON.stringify(attribution)).not.toContain('stripe-subscription')
  })

  it('carries only the normalized Enterprise concurrency metadata needed by admission', async () => {
    mockLimit.mockResolvedValue([
      {
        billedAccountUserId: 'owner-b',
        organizationId: 'org-b',
      },
    ])
    mockGetOrganizationSubscription.mockResolvedValue({
      ...ORG_SUBSCRIPTION,
      plan: 'enterprise',
      metadata: { concurrencyLimit: '1250', secret: 'must-not-cross-boundary' },
    })

    const attribution = await resolveBillingAttribution({
      actorUserId: 'actor-a',
      workspaceId: 'workspace-b',
    })

    expect(attribution.payerSubscription).toMatchObject({
      plan: 'enterprise',
      enterpriseConcurrencyLimit: 1250,
    })
    expect(JSON.stringify(attribution)).not.toContain('must-not-cross-boundary')
  })

  it('rejects a subscription that does not belong to the exact workspace payer', async () => {
    mockLimit.mockResolvedValue([
      {
        billedAccountUserId: 'owner-b',
        organizationId: 'org-b',
      },
    ])
    mockGetOrganizationSubscription.mockResolvedValue({
      ...ORG_SUBSCRIPTION,
      referenceId: 'org-a',
    })

    await expect(
      resolveBillingAttribution({
        actorUserId: 'actor-a',
        workspaceId: 'workspace-b',
      })
    ).rejects.toThrow('does not belong to workspace payer org-b')
  })

  it('fails closed when the workspace payer cannot be resolved', async () => {
    mockLimit.mockResolvedValue([])

    await expect(
      resolveBillingAttribution({
        actorUserId: 'actor-a',
        workspaceId: 'missing-workspace',
      })
    ).rejects.toThrow('Unable to resolve billing payer for workspace missing-workspace')
  })

  it('resolves markerless legacy-v0 from the current workspace payer', async () => {
    mockLimit.mockResolvedValue([
      {
        billedAccountUserId: 'owner-b',
        organizationId: 'org-b',
      },
    ])
    mockGetOrganizationSubscription.mockResolvedValue(ORG_SUBSCRIPTION)

    await expect(
      resolveLegacyV0BillingAttribution({
        actorUserId: 'actor-a',
        workspaceId: 'workspace-b',
      })
    ).resolves.toMatchObject({
      actorUserId: 'actor-a',
      workspaceId: 'workspace-b',
      billedAccountUserId: 'owner-b',
      billingEntity: { type: 'organization', id: 'org-b' },
    })
  })

  it('returns no workspace payer for an opaque markerless legacy-v0 workspace', async () => {
    mockLimit.mockResolvedValue([])

    await expect(
      resolveLegacyV0BillingAttribution({
        actorUserId: 'actor-a',
        workspaceId: 'foreign-workspace',
      })
    ).resolves.toBeNull()
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
    expect(mockGetHighestPriorityPersonalSubscription).not.toHaveBeenCalled()
  })

  it('converts the serialized period back to the exact runtime billing context', async () => {
    mockLimit.mockResolvedValue([
      {
        billedAccountUserId: 'owner-b',
        organizationId: 'org-b',
      },
    ])
    mockGetOrganizationSubscription.mockResolvedValue(ORG_SUBSCRIPTION)
    const attribution = await resolveBillingAttribution({
      actorUserId: 'actor-a',
      workspaceId: 'workspace-b',
    })

    expect(toBillingContext(attribution)).toEqual({
      billingEntity: { type: 'organization', id: 'org-b' },
      billingPeriod: {
        end: new Date('2026-08-01T00:00:00.000Z'),
        start: new Date('2026-07-01T00:00:00.000Z'),
      },
    })
  })
})

describe('serialized attribution boundaries', () => {
  const attribution = {
    actorUserId: 'actor-a',
    billedAccountUserId: 'owner-b',
    billingEntity: { type: 'organization' as const, id: 'org-b' },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    organizationId: 'org-b',
    payerSubscription: {
      id: 'sub-org-b',
      periodEnd: '2026-08-01T00:00:00.000Z',
      periodStart: '2026-07-01T00:00:00.000Z',
      plan: 'team_25000',
      referenceId: 'org-b',
      seats: 4,
      status: 'active',
    },
    workspaceId: 'workspace-b',
  }

  it('round-trips and freezes a trusted internal-request snapshot', () => {
    const headers = new Headers({
      'x-sim-billing-attribution': serializeBillingAttributionHeader(attribution),
    })

    const restored = requireBillingAttributionHeader(headers, {
      actorUserId: 'actor-a',
      workspaceId: 'workspace-b',
    })

    expect(restored).toEqual(attribution)
    expect(Object.isFrozen(restored)).toBe(true)
    expect(Object.isFrozen(restored.payerSubscription)).toBe(true)
  })

  it('fails closed when a required internal snapshot is missing', () => {
    expect(() =>
      requireBillingAttributionHeader(new Headers(), {
        actorUserId: 'actor-a',
        workspaceId: 'workspace-b',
      })
    ).toThrow('Billing attribution header is required')
  })

  it('rejects inconsistent or cross-scope serialized snapshots', () => {
    expect(() =>
      assertBillingAttributionSnapshot({
        ...attribution,
        billingEntity: { type: 'organization', id: 'org-a' },
      })
    ).toThrow('payer fields are inconsistent')

    const headers = new Headers({
      'x-sim-billing-attribution': serializeBillingAttributionHeader(attribution),
    })
    expect(() =>
      requireBillingAttributionHeader(headers, {
        actorUserId: 'other-actor',
        workspaceId: 'workspace-b',
      })
    ).toThrow('does not match the authenticated request scope')
  })

  it('requires a canonical server billing request UUID', () => {
    expect(
      requireBillingRequestIdHeader(
        new Headers({
          'x-sim-billing-request-id': '0190c03f-9f7d-4b79-8b58-e7f779fd29e1',
        })
      )
    ).toBe('0190c03f-9f7d-4b79-8b58-e7f779fd29e1')
    expect(() =>
      requireBillingRequestIdHeader(
        new Headers({ 'x-sim-billing-request-id': 'caller-controlled' })
      )
    ).toThrow('valid billing request ID')
  })

  it('compares independently decoded snapshots canonically', () => {
    expect(
      billingAttributionsEqual(attribution, {
        ...attribution,
        billingPeriod: {
          start: '2026-06-30T20:00:00.000-04:00',
          end: '2026-07-31T20:00:00.000-04:00',
        },
      })
    ).toBe(true)
  })
})

describe('checkAttributedUsageLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isBillingEnabled = true
    mockFlags.isHosted = true
    mockCheckBillingBlocked.mockResolvedValue({ blocked: false })
    mockCheckBillingEntityBlocked.mockResolvedValue({ blocked: false })
    mockCheckUsageStatus.mockResolvedValue({
      currentUsage: 40,
      isExceeded: false,
      limit: 100,
      organizationId: 'org-b',
      percentUsed: 40,
      isWarning: false,
      scope: 'organization',
    })
    mockCheckOrganizationMemberUsageLimit.mockResolvedValue({
      currentUsage: 5,
      isExceeded: false,
      limit: 25,
    })
  })

  const attribution = {
    actorUserId: 'external-a',
    billedAccountUserId: 'owner-b',
    billingEntity: { type: 'organization' as const, id: 'org-b' },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    organizationId: 'org-b',
    payerSubscription: {
      id: 'sub-org-b',
      periodEnd: '2026-08-01T00:00:00.000Z',
      periodStart: '2026-07-01T00:00:00.000Z',
      plan: 'team_25000',
      referenceId: 'org-b',
      seats: 4,
      status: 'active',
    },
    workspaceId: 'workspace-b',
  }

  it('skips hosted freezes and caps when billing is disabled', async () => {
    mockFlags.isBillingEnabled = false

    await expect(checkAttributedUsageLimits(attribution)).resolves.toEqual({
      isExceeded: false,
    })

    expect(mockCheckBillingBlocked).not.toHaveBeenCalled()
    expect(mockCheckBillingEntityBlocked).not.toHaveBeenCalled()
    expect(mockCheckUsageStatus).not.toHaveBeenCalled()
    expect(mockCheckOrganizationMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('checks a BYOK-style block gate against the actor and exact workspace payer', async () => {
    mockCheckBillingEntityBlocked.mockResolvedValue({
      blocked: true,
      message: 'Workspace payer frozen.',
    })

    await expect(checkAttributedBillingBlocks(attribution)).resolves.toEqual({
      blocked: true,
      message: 'Workspace payer frozen.',
      scope: 'payer',
    })

    expect(mockCheckBillingBlocked).toHaveBeenCalledWith('external-a')
    expect(mockCheckBillingEntityBlocked).toHaveBeenCalledWith({
      id: 'org-b',
      type: 'organization',
    })
    expect(mockCheckUsageStatus).not.toHaveBeenCalled()
  })

  it('reuses the actor account block result for the same personal payer', async () => {
    const personalAttribution = {
      ...attribution,
      actorUserId: 'owner-b',
      billingEntity: { type: 'user' as const, id: 'owner-b' },
      organizationId: null,
      payerSubscription: null,
    }

    await expect(checkAttributedBillingBlocks(personalAttribution)).resolves.toEqual({
      blocked: false,
    })

    expect(mockCheckBillingBlocked).toHaveBeenCalledWith('owner-b')
    expect(mockCheckBillingEntityBlocked).not.toHaveBeenCalled()
  })

  it('keeps separate actor and payer checks for a collaborator on a personal workspace', async () => {
    const collaboratorAttribution = {
      ...attribution,
      billingEntity: { type: 'user' as const, id: 'owner-b' },
      organizationId: null,
      payerSubscription: null,
    }

    await expect(checkAttributedBillingBlocks(collaboratorAttribution)).resolves.toEqual({
      blocked: false,
    })

    expect(mockCheckBillingBlocked).toHaveBeenCalledWith('external-a')
    expect(mockCheckBillingEntityBlocked).toHaveBeenCalledWith({
      id: 'owner-b',
      type: 'user',
    })
  })

  it('checks the actor account before the payer pool', async () => {
    mockCheckBillingBlocked.mockResolvedValue({
      blocked: true,
      message: 'Actor account frozen.',
    })

    await expect(checkAttributedUsageLimits(attribution)).resolves.toMatchObject({
      isExceeded: true,
      message: 'Actor account frozen.',
      scope: 'actor',
    })
    expect(mockCheckUsageStatus).not.toHaveBeenCalled()
    expect(mockCheckBillingEntityBlocked).not.toHaveBeenCalled()
    expect(mockCheckOrganizationMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('blocks the exact workspace payer before payer usage or member-cap checks', async () => {
    mockCheckBillingEntityBlocked.mockResolvedValue({
      blocked: true,
      message: 'Organization billing issue.',
    })

    await expect(checkAttributedUsageLimits(attribution)).resolves.toMatchObject({
      isExceeded: true,
      message: 'Organization billing issue.',
      scope: 'payer',
    })
    expect(mockCheckBillingEntityBlocked).toHaveBeenCalledWith({
      id: 'org-b',
      type: 'organization',
    })
    expect(mockCheckUsageStatus).not.toHaveBeenCalled()
    expect(mockCheckOrganizationMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('keeps the workspace organization as payer when it has no subscription', async () => {
    await checkAttributedUsageLimits({ ...attribution, payerSubscription: null })

    expect(mockCheckUsageStatus).toHaveBeenCalledWith('owner-b', {
      periodEnd: new Date('2026-08-01T00:00:00.000Z'),
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      plan: 'free',
      referenceId: 'org-b',
      seats: null,
      status: null,
    })
  })

  it('returns payer exhaustion before checking the actor member cap', async () => {
    mockCheckUsageStatus.mockResolvedValue({
      currentUsage: 100,
      isExceeded: true,
      limit: 100,
      organizationId: 'org-b',
      percentUsed: 100,
      isWarning: false,
      scope: 'organization',
    })

    await expect(checkAttributedUsageLimits(attribution)).resolves.toMatchObject({
      isExceeded: true,
      payerUsage: { currentUsage: 100, limit: 100 },
      scope: 'payer',
    })
    expect(mockCheckUsageStatus).toHaveBeenCalledWith(
      'owner-b',
      expect.objectContaining({ referenceId: 'org-b' })
    )
    expect(mockCheckOrganizationMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('checks the organization-and-actor cap after the payer pool passes', async () => {
    mockCheckOrganizationMemberUsageLimit.mockResolvedValue({
      currentUsage: 25,
      isExceeded: true,
      limit: 25,
      message: 'Member cap exhausted.',
    })

    await expect(checkAttributedUsageLimits(attribution)).resolves.toMatchObject({
      isExceeded: true,
      message: 'Member cap exhausted.',
      payerUsage: { currentUsage: 40, limit: 100 },
      scope: 'member',
    })
    expect(mockCheckOrganizationMemberUsageLimit).toHaveBeenCalledWith('external-a', 'org-b', {
      end: new Date('2026-08-01T00:00:00.000Z'),
      start: new Date('2026-07-01T00:00:00.000Z'),
    })
  })
})

describe('modern billing envelopes', () => {
  const attribution = {
    actorUserId: 'actor-a',
    billedAccountUserId: 'owner-b',
    billingEntity: { type: 'organization' as const, id: 'org-b' },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    organizationId: 'org-b',
    payerSubscription: null,
    workspaceId: 'workspace-b',
  }

  it('creates a complete attributed-v1 envelope without external storage', () => {
    const envelope = createAttributedBillingRequestEnvelope(attribution)

    expect(envelope.billingRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(envelope.headers).toEqual({
      'x-sim-billing-attribution': envelope.serializedAttribution,
      'x-sim-billing-protocol': 'attribution-v1',
      'x-sim-billing-request-id': envelope.billingRequestId,
    })
    expect(JSON.parse(decodeURIComponent(envelope.serializedAttribution))).toEqual(attribution)
  })

  it('round-trips a bounded direct-v1 account decision header', () => {
    const decision = {
      userId: 'user-1',
      billingEntity: { type: 'organization' as const, id: 'org-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
    }
    const serialized = serializeAccountBillingDecisionHeader(decision)
    const headers = new Headers({ 'x-sim-billing-account-decision': serialized })

    expect(requireAccountBillingDecisionHeader(headers)).toEqual(decision)
  })
})
