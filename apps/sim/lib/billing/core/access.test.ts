/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBillingEntityBlockStatus, getEffectiveBillingStatus } from '@/lib/billing/core/access'

/** A clean `user_stats` row as `getEffectiveBillingStatus` selects it. */
const UNBLOCKED_STATS = { blocked: false, blockedReason: null }

describe('getEffectiveBillingStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it("reports the user's own block without consulting memberships", async () => {
    queueTableRows(schemaMock.userStats, [{ blocked: true, blockedReason: 'payment_failed' }])

    await expect(getEffectiveBillingStatus('user-1')).resolves.toEqual({
      billingBlocked: true,
      billingBlockedReason: 'payment_failed',
      blockedByOrgOwner: false,
    })
  })

  it('blocks a clean user whose organization owner is delinquent', async () => {
    queueTableRows(schemaMock.userStats, [UNBLOCKED_STATS])
    queueTableRows(schemaMock.member, [{ organizationId: 'org-1' }])
    queueTableRows(schemaMock.member, [{ userId: 'owner-1' }])
    queueTableRows(schemaMock.userStats, [{ blocked: true, blockedReason: 'dispute' }])

    await expect(getEffectiveBillingStatus('user-1')).resolves.toEqual({
      billingBlocked: true,
      billingBlockedReason: 'dispute',
      blockedByOrgOwner: true,
    })
  })

  it('allows a clean user who owns the organization they belong to', async () => {
    queueTableRows(schemaMock.userStats, [UNBLOCKED_STATS])
    queueTableRows(schemaMock.member, [{ organizationId: 'org-1' }])
    queueTableRows(schemaMock.member, [{ userId: 'user-1' }])

    await expect(getEffectiveBillingStatus('user-1')).resolves.toEqual({
      billingBlocked: false,
      billingBlockedReason: null,
      blockedByOrgOwner: false,
    })
  })
})

describe('getBillingEntityBlockStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  describe('personal payer', () => {
    it('blocks a payer whose own row is blocked', async () => {
      queueTableRows(schemaMock.userStats, [{ blocked: true, blockedReason: 'payment_failed' }])

      await expect(getBillingEntityBlockStatus({ type: 'user', id: 'payer-1' })).resolves.toEqual({
        billingBlocked: true,
        billingBlockedReason: 'payment_failed',
      })
    })

    /**
     * The payer's own row is clean — only membership in a delinquent org blocks
     * them. Reading `user_stats` directly would report "not blocked" here and
     * disagree with every other entitlement gate, because `blockOrgMembers`
     * fans out point-in-time and never marks a member who joins after the block.
     */
    it('blocks a payer whose own row is clean but whose organization owner is delinquent', async () => {
      queueTableRows(schemaMock.userStats, [UNBLOCKED_STATS])
      queueTableRows(schemaMock.member, [{ organizationId: 'org-1' }])
      queueTableRows(schemaMock.member, [{ userId: 'owner-1' }])
      queueTableRows(schemaMock.userStats, [{ blocked: true, blockedReason: 'payment_failed' }])

      await expect(getBillingEntityBlockStatus({ type: 'user', id: 'payer-1' })).resolves.toEqual({
        billingBlocked: true,
        billingBlockedReason: 'payment_failed',
      })
    })

    it('does not widen the payer block shape with blockedByOrgOwner', async () => {
      queueTableRows(schemaMock.userStats, [UNBLOCKED_STATS])
      queueTableRows(schemaMock.member, [])

      const status = await getBillingEntityBlockStatus({ type: 'user', id: 'payer-1' })

      expect(Object.keys(status).sort()).toEqual(['billingBlocked', 'billingBlockedReason'])
    })

    it('allows a clean payer with no memberships', async () => {
      queueTableRows(schemaMock.userStats, [UNBLOCKED_STATS])
      queueTableRows(schemaMock.member, [])

      await expect(getBillingEntityBlockStatus({ type: 'user', id: 'payer-1' })).resolves.toEqual({
        billingBlocked: false,
        billingBlockedReason: null,
      })
    })
  })

  describe('organization payer', () => {
    /**
     * An organization's debt is its owner's own debt. Re-deriving through the
     * owner's memberships would let some unrelated org the owner belongs to
     * block this organization's workspaces.
     */
    it("reads the owner's own row and stops there", async () => {
      queueTableRows(schemaMock.member, [{ userId: 'owner-1' }])
      queueTableRows(schemaMock.userStats, [{ billingBlocked: false, billingBlockedReason: null }])
      queueTableRows(schemaMock.member, [{ organizationId: 'unrelated-org' }])
      queueTableRows(schemaMock.userStats, [{ blocked: true, blockedReason: 'dispute' }])

      await expect(
        getBillingEntityBlockStatus({ type: 'organization', id: 'org-1' })
      ).resolves.toEqual({
        billingBlocked: false,
        billingBlockedReason: null,
      })
    })

    it("blocks when the owner's own row is blocked", async () => {
      queueTableRows(schemaMock.member, [{ userId: 'owner-1' }])
      queueTableRows(schemaMock.userStats, [
        { billingBlocked: true, billingBlockedReason: 'payment_failed' },
      ])

      await expect(
        getBillingEntityBlockStatus({ type: 'organization', id: 'org-1' })
      ).resolves.toEqual({
        billingBlocked: true,
        billingBlockedReason: 'payment_failed',
      })
    })

    it('is not blocked when the organization has no owner row', async () => {
      queueTableRows(schemaMock.member, [])

      await expect(
        getBillingEntityBlockStatus({ type: 'organization', id: 'org-1' })
      ).resolves.toEqual({
        billingBlocked: false,
        billingBlockedReason: null,
      })
    })
  })
})
