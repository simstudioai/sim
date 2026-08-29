/** @vitest-environment node */

import { member, subscription } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveMoveEntitlements } from '@/lib/workspaces/admin-move-source-impact'

vi.unmock('drizzle-orm')

const { isSubscriptionBackedEntitlement } = vi.hoisted(() => ({
  isSubscriptionBackedEntitlement: vi.fn(() => true),
}))

vi.mock('@/lib/billing/core/subscription', () => ({ isSubscriptionBackedEntitlement }))

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
    vi.clearAllMocks()
    resetDbChainMock()
    isSubscriptionBackedEntitlement.mockReturnValue(true)
  })

  it('asks the database only for usable subscriptions', async () => {
    /**
     * Asserted against the SQL rather than with a `past_due` fixture, because
     * the chain mock ignores `WHERE` and would return one regardless.
     *
     * `USABLE_...` and not `ENTITLED_...` is the whole point: the gates this
     * blocker protects resolve through `getOrganizationSubscriptionUsable`,
     * which accepts only `active`. A `past_due` Enterprise subscription is
     * entitled but not usable, so its features are already gone, and reading
     * it as Enterprise would wave a real downgrade through.
     */
    queueTableRows(subscription, [])
    queueTableRows(member, [])

    await resolveMoveEntitlements(SOURCE, DESTINATION)

    const dialect = new PgDialect()
    const rendered = dbChainMockFns.where.mock.calls.map(([condition]) =>
      dialect.sqlToQuery(condition as never)
    )
    const statuses = rendered.flatMap((query) =>
      query.params.filter((param) => param === 'active' || param === 'past_due')
    )
    expect(statuses).toEqual(['active'])
  })

  it('reports no loss for a personal source, which has nothing to lose', async () => {
    await expect(resolveMoveEntitlements(null, DESTINATION)).resolves.toEqual({
      sourceIsEnterprise: false,
      destinationIsEnterprise: false,
      capabilitiesLost: [],
    })
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

  it('reports no loss when both organizations are Enterprise', async () => {
    queueTableRows(subscription, [
      { referenceId: SOURCE, plan: 'enterprise' },
      { referenceId: DESTINATION, plan: 'enterprise' },
    ])
    queueTableRows(member, [])

    await expect(resolveMoveEntitlements(SOURCE, DESTINATION)).resolves.toEqual({
      sourceIsEnterprise: true,
      destinationIsEnterprise: true,
      capabilitiesLost: [],
    })
  })

  it('reports no loss when a non-Enterprise source moves anywhere', async () => {
    queueTableRows(subscription, [{ referenceId: SOURCE, plan: 'team' }])
    queueTableRows(member, [])

    await expect(resolveMoveEntitlements(SOURCE, DESTINATION)).resolves.toEqual({
      sourceIsEnterprise: false,
      destinationIsEnterprise: false,
      capabilitiesLost: [],
    })
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
