/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  canEditUsageLimit,
  checkEnterprisePlan,
  checkProPlan,
  checkTeamPlan,
  hasPaidSubscriptionStatus,
  hasUsableSubscriptionAccess,
  hasUsableSubscriptionStatus,
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
})
