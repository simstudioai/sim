/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReconcileOrganizationSeats, selectRows, mockFeatureFlags } = vi.hoisted(() => ({
  mockReconcileOrganizationSeats: vi.fn(),
  selectRows: { value: [] as unknown[] },
  mockFeatureFlags: { isBillingEnabled: true },
}))

vi.mock('@sim/db', () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.innerJoin = () => chain
    chain.where = () => chain
    chain.groupBy = () => chain
    chain.orderBy = () => Promise.resolve(selectRows.value)
    return chain
  }
  return { db: { select: () => makeChain() } }
})

vi.mock('@/lib/billing/organizations/seats', () => ({
  reconcileOrganizationSeats: mockReconcileOrganizationSeats,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  get isBillingEnabled() {
    return mockFeatureFlags.isBillingEnabled
  },
}))

import { reconcileTeamSeatDrift } from '@/lib/billing/organizations/seat-drift'

describe('reconcileTeamSeatDrift', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectRows.value = []
    mockFeatureFlags.isBillingEnabled = true
    mockReconcileOrganizationSeats.mockResolvedValue({ changed: true, previousSeats: 1, seats: 2 })
  })

  it('reconciles only Team orgs whose seat count drifted from their member count', async () => {
    selectRows.value = [
      { organizationId: 'org-drift', plan: 'team_6000', seats: 1, memberCount: 2 },
      { organizationId: 'org-aligned', plan: 'team_6000', seats: 3, memberCount: 3 },
      { organizationId: 'org-enterprise', plan: 'enterprise', seats: 5, memberCount: 7 },
      { organizationId: 'org-pro', plan: 'pro_6000', seats: 1, memberCount: 4 },
    ]

    const result = await reconcileTeamSeatDrift()

    expect(result).toEqual({ drifted: 1, reconciled: 1 })
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledTimes(1)
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledWith({
      organizationId: 'org-drift',
      reason: 'seat-drift-sweep',
    })
  })

  it('treats a null seat count as one seat', async () => {
    selectRows.value = [
      { organizationId: 'org-null', plan: 'team_6000', seats: null, memberCount: 1 },
      { organizationId: 'org-null-drift', plan: 'team_6000', seats: null, memberCount: 2 },
    ]

    const result = await reconcileTeamSeatDrift()

    expect(result.drifted).toBe(1)
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledWith({
      organizationId: 'org-null-drift',
      reason: 'seat-drift-sweep',
    })
  })

  it('counts only reconciles that changed the seat count', async () => {
    selectRows.value = [
      { organizationId: 'org-a', plan: 'team_6000', seats: 1, memberCount: 2 },
      { organizationId: 'org-b', plan: 'team_6000', seats: 1, memberCount: 3 },
    ]
    mockReconcileOrganizationSeats
      .mockResolvedValueOnce({ changed: true, seats: 2 })
      .mockResolvedValueOnce({ changed: false })

    const result = await reconcileTeamSeatDrift()

    expect(result).toEqual({ drifted: 2, reconciled: 1 })
  })

  it('continues past a reconcile failure', async () => {
    selectRows.value = [
      { organizationId: 'org-a', plan: 'team_6000', seats: 1, memberCount: 2 },
      { organizationId: 'org-b', plan: 'team_6000', seats: 1, memberCount: 3 },
    ]
    mockReconcileOrganizationSeats
      .mockRejectedValueOnce(new Error('db error'))
      .mockResolvedValueOnce({ changed: true, seats: 3 })

    const result = await reconcileTeamSeatDrift()

    expect(result).toEqual({ drifted: 2, reconciled: 1 })
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledTimes(2)
  })

  it('no-ops when billing is disabled', async () => {
    mockFeatureFlags.isBillingEnabled = false

    const result = await reconcileTeamSeatDrift()

    expect(result).toEqual({ drifted: 0, reconciled: 0 })
    expect(mockReconcileOrganizationSeats).not.toHaveBeenCalled()
  })

  it('caps reconciles per run while still reporting the full drift count', async () => {
    selectRows.value = Array.from({ length: 150 }, (_, i) => ({
      organizationId: `org-${i}`,
      plan: 'team_6000',
      seats: 1,
      memberCount: 2,
    }))

    const result = await reconcileTeamSeatDrift()

    expect(result.drifted).toBe(150)
    expect(result.reconciled).toBe(100)
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledTimes(100)
  })
})
