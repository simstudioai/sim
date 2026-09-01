/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getSubscriptionAccessState } from '@/lib/billing/client/utils'
import { MAX_TIER_CREDITS } from '@/lib/billing/constants'
import { getPlanTierCredits, isMaxTier } from '@/lib/billing/plan-helpers'

/**
 * Every plan name the product can put on a subscription row.
 *
 * `pro`/`team` are the legacy bare names; the rest are the `{type}_{credits}`
 * form. A new tier added to `CREDIT_TIERS` must be added here too.
 */
const ALL_PLANS = [
  'free',
  'pro',
  'pro_6000',
  'pro_25000',
  'team',
  'team_6000',
  'team_25000',
  'enterprise',
] as const

/**
 * `isMaxTier` is the sole definition of the Max entitlement. It is consumed by the
 * server gates (`hasWorkspaceInboxAccess`, `hasWorkspaceLiveSyncAccess`,
 * `hasWorkspaceSandboxAccess`) and by the client `hasUsableMaxAccess` that decides
 * whether the settings sidebar renders Sandboxes and Sim Mailer unlocked.
 *
 * Those two must agree for every plan. When they disagreed, the sidebar offered
 * features the API answered 403 for, and the personal-workspace cap inverted so
 * Max-for-Teams and Enterprise got a smaller allowance than plain Pro.
 */
describe('Max tier parity', () => {
  it('admits exactly the plans at or above the Max credit tier, plus enterprise', () => {
    const maxPlans = ALL_PLANS.filter((plan) => isMaxTier(plan))

    expect(maxPlans).toEqual(['pro_25000', 'team_25000', 'enterprise'])
  })

  it('includes both the individual and team plan at the Max credit allocation', () => {
    expect(isMaxTier('pro_25000')).toBe(true)
    expect(isMaxTier('team_25000')).toBe(true)
  })

  it('treats enterprise as Max even though it carries no credit suffix', () => {
    expect(getPlanTierCredits('enterprise')).toBe(0)
    expect(isMaxTier('enterprise')).toBe(true)
  })

  it('excludes every plan below the Max credit allocation', () => {
    for (const plan of ['free', 'pro', 'pro_6000', 'team', 'team_6000']) {
      expect(isMaxTier(plan)).toBe(false)
    }
  })

  it('derives its threshold from the tier table rather than a literal', () => {
    expect(isMaxTier(`pro_${MAX_TIER_CREDITS}`)).toBe(true)
    expect(isMaxTier(`pro_${MAX_TIER_CREDITS - 1}`)).toBe(false)
  })

  it('handles a missing plan without throwing', () => {
    expect(isMaxTier(null)).toBe(false)
    expect(isMaxTier(undefined)).toBe(false)
    expect(isMaxTier('')).toBe(false)
  })

  /**
   * The client gate layers subscription status and billing-blocked state on top of
   * the tier predicate, so with an active, unblocked payer the two must return the
   * same answer for every plan. A divergence here is the render-unlocked-then-403
   * bug class.
   */
  it('matches the client hasUsableMaxAccess derivation for every plan', () => {
    for (const plan of ALL_PLANS) {
      const client = getSubscriptionAccessState({
        plan,
        status: 'active',
        isPaid: true,
        billingBlocked: false,
      })

      expect(client.hasUsableMaxAccess, `plan ${plan}`).toBe(isMaxTier(plan))
    }
  })

  it('denies Max on the client for a blocked or non-active payer even at the Max tier', () => {
    expect(
      getSubscriptionAccessState({
        plan: 'pro_25000',
        status: 'active',
        isPaid: true,
        billingBlocked: true,
      }).hasUsableMaxAccess
    ).toBe(false)

    expect(
      getSubscriptionAccessState({
        plan: 'pro_25000',
        status: 'past_due',
        isPaid: true,
        billingBlocked: false,
      }).hasUsableMaxAccess
    ).toBe(false)
  })
})
