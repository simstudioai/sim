import {
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import {
  organizationSeatsMock,
  organizationSeatsMockFns,
} from '@sim/testing/mocks/organization-seats.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/organizations/seats', () => organizationSeatsMock)

import { reconcileTeamSeatDrift } from '@/lib/billing/organizations/seat-drift'

const mockReconcileOrganizationSeats = organizationSeatsMockFns.mockReconcileOrganizationSeats

afterAll(resetEnvFlagsMock)

describe('reconcileTeamSeatDrift', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
    mockReconcileOrganizationSeats.mockResolvedValue({ changed: true, previousSeats: 1, seats: 2 })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('reconciles each drifted Team org returned by the query', async () => {
    // The SQL WHERE (Team-only) + HAVING (seats != member count) already
    // restrict the result to drifted Team orgs; the function reconciles each.
    queueTableRows(schemaMock.subscription, [
      { organizationId: 'org-1' },
      { organizationId: 'org-2' },
    ])

    const result = await reconcileTeamSeatDrift()

    expect(result).toEqual({ drifted: 2, reconciled: 2 })
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledTimes(2)
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledWith({
      organizationId: 'org-1',
      reason: 'seat-drift-sweep',
    })
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledWith({
      organizationId: 'org-2',
      reason: 'seat-drift-sweep',
    })
  })

  it('counts only reconciles that changed the seat count', async () => {
    queueTableRows(schemaMock.subscription, [
      { organizationId: 'org-a' },
      { organizationId: 'org-b' },
    ])
    mockReconcileOrganizationSeats
      .mockResolvedValueOnce({ changed: true, seats: 2 })
      .mockResolvedValueOnce({ changed: false })

    const result = await reconcileTeamSeatDrift()

    expect(result).toEqual({ drifted: 2, reconciled: 1 })
  })

  it('continues past a reconcile failure', async () => {
    queueTableRows(schemaMock.subscription, [
      { organizationId: 'org-a' },
      { organizationId: 'org-b' },
    ])
    mockReconcileOrganizationSeats
      .mockRejectedValueOnce(new Error('db error'))
      .mockResolvedValueOnce({ changed: true, seats: 3 })

    const result = await reconcileTeamSeatDrift()

    expect(result).toEqual({ drifted: 2, reconciled: 1 })
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledTimes(2)
  })

  it('caps reconciles per run while still reporting the full drift count', async () => {
    queueTableRows(
      schemaMock.subscription,
      Array.from({ length: 150 }, (_, i) => ({ organizationId: `org-${i}` }))
    )

    const result = await reconcileTeamSeatDrift()

    expect(result.drifted).toBe(150)
    expect(result.reconciled).toBe(100)
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledTimes(100)
  })
})
