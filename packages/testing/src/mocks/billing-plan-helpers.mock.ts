import { vi } from 'vitest'

type Plan = string | null | undefined
type PlanCategory = 'free' | 'pro' | 'team' | 'enterprise'

/** Mirrors `CREDIT_TIERS` in `@/lib/billing/constants`. */
const CREDIT_TIERS = [
  { credits: 6000, dollars: 25, weeklyRefreshCredits: 2000, name: 'Pro' },
  { credits: 25000, dollars: 100, weeklyRefreshCredits: 4000, name: 'Max' },
] as const
const MAX_TIER_CREDITS = 25000
const CREDITS_PER_DOLLAR = 200
const DEFAULT_PRO_TIER_COST_LIMIT = 20
const DEFAULT_TEAM_TIER_COST_LIMIT = 40

function isPro(plan: Plan): boolean {
  if (!plan) return false
  return plan === 'pro' || plan.startsWith('pro_')
}

function isTeam(plan: Plan): boolean {
  if (!plan) return false
  return plan === 'team' || plan.startsWith('team_')
}

function isFree(plan: Plan): boolean {
  return !plan || plan === 'free'
}

function isEnterprise(plan: Plan): boolean {
  return plan === 'enterprise'
}

function isPaid(plan: Plan): boolean {
  return isPro(plan) || isTeam(plan) || isEnterprise(plan)
}

function isOrgPlan(plan: Plan): boolean {
  return isTeam(plan) || isEnterprise(plan)
}

function getPlanTierCredits(plan: Plan): number {
  if (!plan) return 0
  const match = plan.match(/_(\d+)$/)
  if (match) return Number.parseInt(match[1], 10)
  if (plan === 'pro') return 4000
  if (plan === 'team') return 8000
  return 0
}

function isMaxTier(plan: Plan): boolean {
  return getPlanTierCredits(plan) >= MAX_TIER_CREDITS || isEnterprise(plan)
}

function getPlanTierDollars(plan: Plan): number {
  if (!plan) return 0
  const credits = getPlanTierCredits(plan)
  const tier = CREDIT_TIERS.find((t) => t.credits === credits)
  if (tier) return tier.dollars
  if (plan === 'pro') return DEFAULT_PRO_TIER_COST_LIMIT
  if (plan === 'team') return DEFAULT_TEAM_TIER_COST_LIMIT
  return 0
}

function getPlanWeeklyRefreshDollars(plan: Plan): number {
  if (!isPaid(plan) || isEnterprise(plan)) return 0
  const tier = getPlanTierCredits(plan) >= MAX_TIER_CREDITS ? CREDIT_TIERS[1] : CREDIT_TIERS[0]
  return tier.weeklyRefreshCredits / CREDITS_PER_DOLLAR
}

function getPlanType(plan: Plan): PlanCategory {
  if (isPro(plan)) return 'pro'
  if (isTeam(plan)) return 'team'
  if (isEnterprise(plan)) return 'enterprise'
  return 'free'
}

function getPlanTypeForLimits(plan: Plan): PlanCategory {
  if (plan === 'pro' || plan === 'team') return getPlanType(plan)
  if (isPro(plan) || isTeam(plan)) {
    return getPlanTierCredits(plan) >= MAX_TIER_CREDITS ? 'team' : 'pro'
  }
  return getPlanType(plan)
}

function buildPlanName(type: 'pro' | 'team', credits: number): string {
  return `${type}_${credits}`
}

function getDisplayPlanName(plan: Plan): string {
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

/**
 * Controllable mock functions for `@/lib/billing/plan-helpers`.
 *
 * Every plan predicate and tier helper (`isPro`, `isTeam`, `isFree`, `isEnterprise`, `isPaid`,
 * `isOrgPlan`, `isMaxTier`, `getPlanTierCredits`, `getPlanTierDollars`,
 * `getPlanWeeklyRefreshDollars`, `getPlanType`, `getPlanTypeForLimits`, `buildPlanName`,
 * `getDisplayPlanName`) defaults to a faithful port of the real pure logic, including the
 * `pro_*`/`team_*` tier suffixes and the legacy `pro`/`team` names. The SQL builders
 * `sqlIsPro`/`sqlIsTeam`/`sqlIsPaid` are bare `vi.fn()` (they return `undefined`).
 *
 * @example
 * ```ts
 * import { billingPlanHelpersMockFns } from '@sim/testing/mocks/billing-plan-helpers.mock'
 *
 * billingPlanHelpersMockFns.mockIsEnterprise.mockReturnValue(true)
 * ```
 */
export const billingPlanHelpersMockFns = {
  mockIsPro: vi.fn(isPro),
  mockIsMaxTier: vi.fn(isMaxTier),
  mockIsTeam: vi.fn(isTeam),
  mockIsFree: vi.fn(isFree),
  mockIsEnterprise: vi.fn(isEnterprise),
  mockIsPaid: vi.fn(isPaid),
  mockIsOrgPlan: vi.fn(isOrgPlan),
  mockGetPlanTierCredits: vi.fn(getPlanTierCredits),
  mockGetPlanTierDollars: vi.fn(getPlanTierDollars),
  mockGetPlanWeeklyRefreshDollars: vi.fn(getPlanWeeklyRefreshDollars),
  mockGetPlanType: vi.fn(getPlanType),
  mockGetPlanTypeForLimits: vi.fn(getPlanTypeForLimits),
  mockBuildPlanName: vi.fn(buildPlanName),
  mockSqlIsPro: vi.fn(),
  mockSqlIsTeam: vi.fn(),
  mockSqlIsPaid: vi.fn(),
  mockGetDisplayPlanName: vi.fn(getDisplayPlanName),
}

/**
 * Static mock module for `@/lib/billing/plan-helpers`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/plan-helpers', () => billingPlanHelpersMock)
 * ```
 */
export const billingPlanHelpersMock = {
  isPro: billingPlanHelpersMockFns.mockIsPro,
  isMaxTier: billingPlanHelpersMockFns.mockIsMaxTier,
  isTeam: billingPlanHelpersMockFns.mockIsTeam,
  isFree: billingPlanHelpersMockFns.mockIsFree,
  isEnterprise: billingPlanHelpersMockFns.mockIsEnterprise,
  isPaid: billingPlanHelpersMockFns.mockIsPaid,
  isOrgPlan: billingPlanHelpersMockFns.mockIsOrgPlan,
  getPlanTierCredits: billingPlanHelpersMockFns.mockGetPlanTierCredits,
  getPlanTierDollars: billingPlanHelpersMockFns.mockGetPlanTierDollars,
  getPlanWeeklyRefreshDollars: billingPlanHelpersMockFns.mockGetPlanWeeklyRefreshDollars,
  getPlanType: billingPlanHelpersMockFns.mockGetPlanType,
  getPlanTypeForLimits: billingPlanHelpersMockFns.mockGetPlanTypeForLimits,
  buildPlanName: billingPlanHelpersMockFns.mockBuildPlanName,
  sqlIsPro: billingPlanHelpersMockFns.mockSqlIsPro,
  sqlIsTeam: billingPlanHelpersMockFns.mockSqlIsTeam,
  sqlIsPaid: billingPlanHelpersMockFns.mockSqlIsPaid,
  getDisplayPlanName: billingPlanHelpersMockFns.mockGetDisplayPlanName,
}
