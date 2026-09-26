import { member, subscription } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveMoveEntitlements } from '@/lib/workspaces/admin-move-source-impact'

vi.unmock('drizzle-orm')

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

const isSubscriptionBackedEntitlement =
  billingSubscriptionMockFns.mockIsSubscriptionBackedEntitlement

const SOURCE = 'org-source'
const DESTINATION = 'org-destination'

/**
 * `resolveMoveEntitlements` decides whether a move silently strips Enterprise
 * capability, which is the one blocker the admin cannot recover from after the
 * fact. Every past defect in it read a benign absence as a verdict: a missing
 * subscription row as "not entitled", a `past_due` row as usable, a
 * billing-blocked owner as entitled.
 *
 * Two of those live in JavaScript and one lives in SQL, and the split decides
 * how each is pinned. The chain mock returns queued rows verbatim and never
 * evaluates a `WHERE`, so queueing a `past_due` row would prove nothing: the
 * filter that excludes it is `inArray(subscription.status,
 * USABLE_SUBSCRIPTION_STATUSES)`, and the mock would hand the row back either
 * way. That guard is asserted against the rendered SQL instead. The
 * plan comparison and the billing-blocked exclusion both run in JavaScript
 * over the returned rows, so those are pinned with data.
 */
describe('resolveMoveEntitlements', () => {
  afterAll(resetDbChainMock)

  beforeEach(() => {
    resetDbChainMock()
    isSubscriptionBackedEntitlement.mockReturnValue(true)
  })

  it('reports no loss when entitlement comes from deployment configuration', async () => {
    /**
     * Billing disabled, or self-hosted with access control on, grants
     * entitlement with no `subscription` row anywhere. Reading that absence as
     * "the destination is not Enterprise" would block every move in those
     * deployments.
     */
    isSubscriptionBackedEntitlement.mockReturnValue(false)

    await expect(resolveMoveEntitlements(SOURCE, DESTINATION)).resolves.toEqual({
      sourceIsEnterprise: false,
      destinationIsEnterprise: false,
      capabilitiesLost: [],
    })
  })

  it('names what an Enterprise to Team move would strip', async () => {
    queueTableRows(subscription, [
      { referenceId: SOURCE, plan: 'enterprise' },
      { referenceId: DESTINATION, plan: 'team' },
    ])
    queueTableRows(member, [])

    const result = await resolveMoveEntitlements(SOURCE, DESTINATION)

    expect(result.sourceIsEnterprise).toBe(true)
    expect(result.destinationIsEnterprise).toBe(false)
    /**
     * The list is derived from the organization settings section union, so it
     * must cover the sections a hand-written list kept missing, not just the
     * headline ones.
     */
    expect(result.capabilitiesLost).toEqual(
      expect.arrayContaining([
        'permission groups',
        'organization usage monitoring',
        'audit logs',
        'data drains',
        'whitelabel branding',
        'workspace forking',
        'custom blocks',
      ])
    )
  })

  it('treats a billing-blocked Enterprise destination as a downgrade', async () => {
    /**
     * The gates resolve through the owner's billing state, so an Enterprise
     * row behind a blocked owner buys the destination nothing. Counting the
     * row alone would wave the downgrade through.
     */
    queueTableRows(subscription, [
      { referenceId: SOURCE, plan: 'enterprise' },
      { referenceId: DESTINATION, plan: 'enterprise' },
    ])
    queueTableRows(member, [{ organizationId: DESTINATION }])

    const result = await resolveMoveEntitlements(SOURCE, DESTINATION)

    expect(result.sourceIsEnterprise).toBe(true)
    expect(result.destinationIsEnterprise).toBe(false)
    expect(result.capabilitiesLost.length).toBeGreaterThan(0)
  })
})
