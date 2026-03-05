/**
 * Plan type helpers for the credit-tier billing system.
 *
 * Plan names follow the convention `{type}_{credits}`:
 *   - `pro_2000`, `pro_4000`, ..., `pro_20000`
 *   - `team_2000`, `team_4000`, ..., `team_20000`
 *   - `free`, `enterprise` (unchanged)
 *
 * Legacy plan names (`pro`, `team`) are also recognized for backward compat.
 */

import { CREDIT_TIERS } from '@/lib/billing/constants'
import { creditsToDollars } from '@/lib/billing/credits/conversion'

export type PlanCategory = 'free' | 'pro' | 'team' | 'enterprise'

export function isPro(plan: string | null | undefined): boolean {
  if (!plan) return false
  return plan === 'pro' || plan.startsWith('pro_')
}

export function isTeam(plan: string | null | undefined): boolean {
  if (!plan) return false
  return plan === 'team' || plan.startsWith('team_')
}

export function isFree(plan: string | null | undefined): boolean {
  return !plan || plan === 'free'
}

export function isEnterprise(plan: string | null | undefined): boolean {
  return plan === 'enterprise'
}

export function isPaid(plan: string | null | undefined): boolean {
  return isPro(plan) || isTeam(plan) || isEnterprise(plan)
}

export function isOrgPlan(plan: string | null | undefined): boolean {
  return isTeam(plan) || isEnterprise(plan)
}

/**
 * Extract the credit count from a plan name (e.g. `'pro_4000'` => `4000`).
 * Falls back to the lowest tier for legacy names (`'pro'` => 2000, `'team'` => 4000).
 */
export function getPlanTierCredits(plan: string | null | undefined): number {
  if (!plan) return 0
  const match = plan.match(/_(\d+)$/)
  if (match) return Number.parseInt(match[1], 10)
  if (plan === 'pro') return 2000
  if (plan === 'team') return 4000
  return 0
}

/**
 * Get the dollar value of a plan's credit tier.
 */
export function getPlanTierDollars(plan: string | null | undefined): number {
  return creditsToDollars(getPlanTierCredits(plan))
}

/**
 * Return the broad plan category regardless of tier suffix.
 */
export function getPlanType(plan: string | null | undefined): PlanCategory {
  if (isPro(plan)) return 'pro'
  if (isTeam(plan)) return 'team'
  if (isEnterprise(plan)) return 'enterprise'
  return 'free'
}

/**
 * Build the canonical plan name for a given type and credit tier.
 * @example buildPlanName('pro', 4000) => 'pro_4000'
 */
export function buildPlanName(type: 'pro' | 'team', credits: number): string {
  return `${type}_${credits}`
}

/**
 * Get the list of valid plan names for a given category.
 */
export function getValidPlanNames(type: 'pro' | 'team'): string[] {
  return CREDIT_TIERS.map((t) => buildPlanName(type, t.credits))
}
