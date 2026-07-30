/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  canEditUsageLimit,
  checkEnterprisePlan,
  checkProPlan,
  checkTeamPlan,
  getEffectiveSeats,
  hasPaidSubscriptionStatus,
  hasUsableSubscriptionAccess,
  hasUsableSubscriptionStatus,
  TERMINAL_SUBSCRIPTION_STATUSES,
} from '@/lib/billing/subscriptions/utils'

describe('billing subscription status helpers', () => {
  it('treats past_due as paid entitlement but not usable access', () => {
    expect(hasPaidSubscriptionStatus('active')).toBe(true)
    expect(hasPaidSubscriptionStatus('past_due')).toBe(true)
    expect(hasPaidSubscriptionStatus('canceled')).toBe(false)

    expect(hasUsableSubscriptionStatus('active')).toBe(true)
    expect(hasUsableSubscriptionStatus('past_due')).toBe(false)
    expect(hasUsableSubscriptionStatus('incomplete')).toBe(false)

    expect(hasUsableSubscriptionAccess('active', false)).toBe(true)
    expect(hasUsableSubscriptionAccess('active', true)).toBe(false)
    expect(hasUsableSubscriptionAccess('past_due', false)).toBe(false)
  })

  it('keeps paid plan checks true for past_due subscriptions', () => {
    expect(checkProPlan({ plan: 'pro_4000', status: 'past_due' })).toBe(true)
    expect(checkTeamPlan({ plan: 'team_8000', status: 'past_due' })).toBe(true)
    expect(checkEnterprisePlan({ plan: 'enterprise', status: 'past_due' })).toBe(true)
  })

  it('only allows usage limit editing for active usable subscriptions', () => {
    expect(canEditUsageLimit({ plan: 'pro_4000', status: 'active' })).toBe(true)
    expect(canEditUsageLimit({ plan: 'team_8000', status: 'active' })).toBe(true)

    expect(canEditUsageLimit({ plan: 'pro_4000', status: 'past_due' })).toBe(false)
    expect(canEditUsageLimit({ plan: 'team_8000', status: 'past_due' })).toBe(false)
    expect(canEditUsageLimit({ plan: 'enterprise', status: 'active' })).toBe(false)
    expect(canEditUsageLimit({ plan: 'free', status: 'active' })).toBe(false)
  })

  it('falls back to one seat for entitled team subscriptions before seats sync completes', () => {
    expect(getEffectiveSeats({ plan: 'team_8000', status: 'active', seats: null })).toBe(1)
    expect(getEffectiveSeats({ plan: 'team_8000', status: 'past_due', seats: undefined })).toBe(1)
    expect(getEffectiveSeats({ plan: 'team_8000', status: 'canceled', seats: null })).toBe(0)
  })
})

describe('TERMINAL_SUBSCRIPTION_STATUSES', () => {
  const terminal = TERMINAL_SUBSCRIPTION_STATUSES as readonly string[]

  it('covers only the statuses that can no longer bill', () => {
    expect(terminal).toEqual(['canceled', 'incomplete_expired'])
  })

  it('does not treat trialing as terminal', () => {
    /**
     * A trial grants no entitlement, so it is absent from
     * ENTITLED_SUBSCRIPTION_STATUSES — but it is a live Stripe subscription
     * that will convert. Anything keying off "is this row still real" must not
     * reuse the entitlement set, or it will happily delete out from under an
     * active trial.
     */
    expect(terminal).not.toContain('trialing')
  })

  it('treats every other live status as non-terminal', () => {
    for (const status of ['active', 'past_due', 'unpaid', 'trialing', 'incomplete']) {
      expect(terminal).not.toContain(status)
    }
  })
})
