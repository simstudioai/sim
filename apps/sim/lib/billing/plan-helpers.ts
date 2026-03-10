/**
 * Plan type helpers for the credit-tier billing system.
 *
 * Plan names follow the convention `{type}_{credits}`:
 *   - `pro_6000` (Pro), `pro_25000` (Max)
 *   - `team_6000` (Team Pro), `team_25000` (Team Max)
 *   - `free`, `enterprise` (unchanged)
 *
 * Legacy plan names (`pro`, `team`) are also recognized for backward compat
 * and map to their original dollar amounts ($20 / $40).
 */

import {
  CREDIT_TIERS,
  DEFAULT_PRO_TIER_COST_LIMIT,
  DEFAULT_TEAM_TIER_COST_LIMIT,
} from '@/lib/billing/constants'

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
 * Extract the credit count from a plan name (e.g. `'pro_6000'` => `6000`).
 * Legacy names map to their original dollar values:
 *   `'pro'` => 4000 credits ($20 at 1:200), `'team'` => 8000 credits ($40 at 1:200).
 */
export function getPlanTierCredits(plan: string | null | undefined): number {
  if (!plan) return 0
  const match = plan.match(/_(\d+)$/)
  if (match) return Number.parseInt(match[1], 10)
  if (plan === 'pro') return 4000
  if (plan === 'team') return 8000
  return 0
}

/**
 * Get the dollar value of a plan's credit tier.
 * Looks up from CREDIT_TIERS for exact mapping, with legacy plan fallbacks.
 */
export function getPlanTierDollars(plan: string | null | undefined): number {
  if (!plan) return 0
  const credits = getPlanTierCredits(plan)
  const tier = CREDIT_TIERS.find((t) => t.credits === credits)
  if (tier) return tier.dollars
  if (plan === 'pro') return DEFAULT_PRO_TIER_COST_LIMIT
  if (plan === 'team') return DEFAULT_TEAM_TIER_COST_LIMIT
  return 0
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
 * Return the plan category used for rate limits, storage, and execution timeouts.
 * Max plans (>= 25K credits) are promoted to team-level limits.
 */
export function getPlanTypeForLimits(plan: string | null | undefined): PlanCategory {
  const credits = getPlanTierCredits(plan)
  if (credits >= 25000 && isPro(plan)) return 'team'
  return getPlanType(plan)
}

/**
 * Build the canonical plan name for a given type and credit tier.
 * @example buildPlanName('pro', 6000) => 'pro_6000'
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

/**
 * Get the user-facing display name for a plan.
 * @example getDisplayPlanName('pro_25000') => 'Max'
 * @example getDisplayPlanName('team_6000') => 'Pro for Teams'
 * @example getDisplayPlanName('pro') => 'Legacy Pro'
 */
export function getDisplayPlanName(plan: string | null | undefined): string {
  if (!plan || isFree(plan)) return 'Free'
  if (isEnterprise(plan)) return 'Enterprise'
  const credits = getPlanTierCredits(plan)
  const tier = CREDIT_TIERS.find((t) => t.credits === credits)
  const isLegacy = plan === 'pro' || plan === 'team'
  const tierName = tier?.name ?? (plan === 'team' ? 'Max' : 'Pro')
  const prefix = isLegacy ? 'Legacy ' : ''
  const suffix = isTeam(plan) ? ' for Teams' : ''
  return `${prefix}${tierName}${suffix}`
}
