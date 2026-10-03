/**
 * Pure billing-plan logic shared by the central billing mocks, so a plan-pricing or
 * plan-predicate fix lands once instead of drifting between mock modules. Ports of the real
 * `@/lib/billing/subscriptions/utils` and `@/lib/billing/plan-helpers` helpers with the
 * `@/lib/billing/constants` env overrides unset, as they are under test.
 */

type Plan = string | null | undefined

/** Mirrors `@/lib/billing/constants` defaults (env overrides are unset under test). */
export const DEFAULT_FREE_CREDITS = 5
export const DEFAULT_PRO_TIER_COST_LIMIT = 20
export const DEFAULT_TEAM_TIER_COST_LIMIT = 40
export const DEFAULT_ENTERPRISE_TIER_COST_LIMIT = 200
export const CREDIT_MULTIPLIER = 200

export function isPro(plan: Plan): boolean {
  return Boolean(plan) && (plan === 'pro' || Boolean(plan?.startsWith('pro_')))
}

export function isTeam(plan: Plan): boolean {
  return Boolean(plan) && (plan === 'team' || Boolean(plan?.startsWith('team_')))
}

export function isEnterprise(plan: Plan): boolean {
  return plan === 'enterprise'
}

export function isFree(plan: Plan): boolean {
  return !plan || plan === 'free'
}

export function isOrgPlan(plan: Plan): boolean {
  return isTeam(plan) || isEnterprise(plan)
}

export function getPlanTierCredits(plan: Plan): number {
  if (!plan) return 0
  const match = plan.match(/_(\d+)$/)
  if (match) return Number.parseInt(match[1], 10)
  if (plan === 'pro') return 4000
  if (plan === 'team') return 8000
  return 0
}

/** Faithful port of the real `getPlanPricing` with env overrides unset. */
export function getPlanPricing(plan: string): { basePrice: number } {
  if (isFree(plan)) return { basePrice: 0 }
  if (isEnterprise(plan)) return { basePrice: DEFAULT_ENTERPRISE_TIER_COST_LIMIT }
  if (isPro(plan) || isTeam(plan)) {
    const tierCredits = getPlanTierCredits(plan)
    if (tierCredits > 0) return { basePrice: tierCredits / CREDIT_MULTIPLIER }
    return {
      basePrice: isPro(plan) ? DEFAULT_PRO_TIER_COST_LIMIT : DEFAULT_TEAM_TIER_COST_LIMIT,
    }
  }
  return { basePrice: 0 }
}
