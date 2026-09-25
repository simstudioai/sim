import { vi } from 'vitest'

type Plan = string | null | undefined
type Status = string | null | undefined

interface SubscriptionLike {
  plan?: string | null
  status?: string | null
  seats?: number | null
  metadata?: unknown
  referenceId?: string | null
}

const ENTITLED_SUBSCRIPTION_STATUSES = ['active', 'past_due'] as const
const USABLE_SUBSCRIPTION_STATUSES = ['active'] as const
const TERMINAL_SUBSCRIPTION_STATUSES = ['canceled', 'incomplete_expired'] as const

/** Mirrors `@/lib/billing/constants` defaults (env overrides are unset under test). */
const DEFAULT_FREE_CREDITS = 5
const DEFAULT_PRO_TIER_COST_LIMIT = 20
const DEFAULT_TEAM_TIER_COST_LIMIT = 40
const DEFAULT_ENTERPRISE_TIER_COST_LIMIT = 200
const CREDIT_MULTIPLIER = 200

function isPro(plan: Plan): boolean {
  return Boolean(plan) && (plan === 'pro' || Boolean(plan?.startsWith('pro_')))
}

function isTeam(plan: Plan): boolean {
  return Boolean(plan) && (plan === 'team' || Boolean(plan?.startsWith('team_')))
}

function isEnterprise(plan: Plan): boolean {
  return plan === 'enterprise'
}

function isFree(plan: Plan): boolean {
  return !plan || plan === 'free'
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

function hasPaidSubscriptionStatus(status: Status): boolean {
  return (ENTITLED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status as string)
}

function hasUsableSubscriptionStatus(status: Status): boolean {
  return (USABLE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status as string)
}

function hasUsableSubscriptionAccess(
  status: Status,
  billingBlocked: boolean | null | undefined
): boolean {
  return hasUsableSubscriptionStatus(status) && !billingBlocked
}

function getFreeTierLimit(): number {
  return DEFAULT_FREE_CREDITS
}

function getProTierLimit(): number {
  return DEFAULT_PRO_TIER_COST_LIMIT
}

function getTeamTierLimitPerSeat(): number {
  return DEFAULT_TEAM_TIER_COST_LIMIT
}

function getEnterpriseTierLimitPerSeat(): number {
  return DEFAULT_ENTERPRISE_TIER_COST_LIMIT
}

function checkEnterprisePlan(subscription: SubscriptionLike | null | undefined): boolean {
  return isEnterprise(subscription?.plan) && hasPaidSubscriptionStatus(subscription?.status)
}

function checkProPlan(subscription: SubscriptionLike | null | undefined): boolean {
  return isPro(subscription?.plan) && hasPaidSubscriptionStatus(subscription?.status)
}

function checkTeamPlan(subscription: SubscriptionLike | null | undefined): boolean {
  return isTeam(subscription?.plan) && hasPaidSubscriptionStatus(subscription?.status)
}

function checkOrgPlan(subscription: SubscriptionLike | null | undefined): boolean {
  return isOrgPlan(subscription?.plan) && hasPaidSubscriptionStatus(subscription?.status)
}

/**
 * Simplified `parseEnterpriseSubscriptionMetadata(...).seats`: requires `plan` `enterprise`
 * (any case), a non-empty `referenceId`, a positive integer `seats`, and an
 * `invoiceAmountCents` or `monthlyPrice`. The real zod schema also validates the optional
 * reporting-period, concurrency, and timeout fields.
 */
function enterpriseSeats(metadata: unknown): number {
  if (typeof metadata !== 'object' || metadata === null) return 0
  const m = metadata as Record<string, unknown>
  if (typeof m.plan !== 'string' || m.plan.toLowerCase() !== 'enterprise') return 0
  if (typeof m.referenceId !== 'string' || m.referenceId.length === 0) return 0
  if (m.invoiceAmountCents === undefined && m.monthlyPrice === undefined) return 0
  const seats = Number(m.seats)
  return Number.isInteger(seats) && seats > 0 ? seats : 0
}

function getEffectiveSeats(subscription: SubscriptionLike | null | undefined): number {
  if (!subscription) return 0
  if (isEnterprise(subscription.plan)) return enterpriseSeats(subscription.metadata)
  if (isTeam(subscription.plan)) {
    return subscription.seats ?? (hasPaidSubscriptionStatus(subscription.status) ? 1 : 0)
  }
  if (isPro(subscription.plan)) return subscription.seats ?? 0
  return 0
}

function isOrgScopedSubscription(
  subscription: { referenceId?: string | null } | null | undefined,
  userId: string
): boolean {
  if (!subscription?.referenceId) return false
  return subscription.referenceId !== userId
}

function getPerUserMinimumLimit(subscription: SubscriptionLike | null | undefined): number {
  if (!subscription || !hasPaidSubscriptionStatus(subscription.status)) {
    return getFreeTierLimit()
  }
  if (isPro(subscription.plan)) {
    const tierCredits = getPlanTierCredits(subscription.plan)
    if (tierCredits > 0) return tierCredits / CREDIT_MULTIPLIER
    return getProTierLimit()
  }
  if (isOrgPlan(subscription.plan)) return 0
  return getFreeTierLimit()
}

function canEditUsageLimit(subscription: SubscriptionLike | null | undefined): boolean {
  if (!subscription || !hasUsableSubscriptionStatus(subscription.status)) return false
  return isPro(subscription.plan) || isTeam(subscription.plan)
}

function getPlanPricing(plan: string): { basePrice: number } {
  if (isFree(plan)) return { basePrice: 0 }
  if (isEnterprise(plan)) return { basePrice: getEnterpriseTierLimitPerSeat() }
  if (isPro(plan) || isTeam(plan)) {
    const tierCredits = getPlanTierCredits(plan)
    if (tierCredits > 0) return { basePrice: tierCredits / CREDIT_MULTIPLIER }
    return { basePrice: isPro(plan) ? getProTierLimit() : getTeamTierLimitPerSeat() }
  }
  return { basePrice: 0 }
}

/**
 * Controllable mock functions for `@/lib/billing/subscriptions/utils`.
 *
 * Every export is a pure helper, so every fn defaults to a faithful port of the real logic
 * (status predicates, `check*Plan`, `isOrgScopedSubscription`, `getEffectiveSeats`,
 * `getPerUserMinimumLimit`, `canEditUsageLimit`, `getPlanPricing`). The tier-limit getters
 * return the `@/lib/billing/constants` defaults (free 5, pro 20, team 40, enterprise 200)
 * because the env overrides are unset under test. `getEffectiveSeats` reads Enterprise seats
 * through a simplified metadata check (see `enterpriseSeats`).
 *
 * @example
 * ```ts
 * import { billingSubscriptionUtilsMockFns } from '@sim/testing/mocks/billing-subscription-utils.mock'
 *
 * billingSubscriptionUtilsMockFns.mockGetEffectiveSeats.mockReturnValue(10)
 * ```
 */
export const billingSubscriptionUtilsMockFns = {
  mockHasPaidSubscriptionStatus: vi.fn(hasPaidSubscriptionStatus),
  mockHasUsableSubscriptionStatus: vi.fn(hasUsableSubscriptionStatus),
  mockHasUsableSubscriptionAccess: vi.fn(hasUsableSubscriptionAccess),
  mockGetFreeTierLimit: vi.fn(getFreeTierLimit),
  mockGetProTierLimit: vi.fn(getProTierLimit),
  mockGetTeamTierLimitPerSeat: vi.fn(getTeamTierLimitPerSeat),
  mockGetEnterpriseTierLimitPerSeat: vi.fn(getEnterpriseTierLimitPerSeat),
  mockCheckEnterprisePlan: vi.fn(checkEnterprisePlan),
  mockGetEffectiveSeats: vi.fn(getEffectiveSeats),
  mockCheckProPlan: vi.fn(checkProPlan),
  mockCheckTeamPlan: vi.fn(checkTeamPlan),
  mockCheckOrgPlan: vi.fn(checkOrgPlan),
  mockIsOrgScopedSubscription: vi.fn(isOrgScopedSubscription),
  mockGetPerUserMinimumLimit: vi.fn(getPerUserMinimumLimit),
  mockCanEditUsageLimit: vi.fn(canEditUsageLimit),
  mockGetPlanPricing: vi.fn(getPlanPricing),
}

/**
 * Static mock module for `@/lib/billing/subscriptions/utils`. The status constants carry the
 * real values.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/subscriptions/utils', () => billingSubscriptionUtilsMock)
 * ```
 */
export const billingSubscriptionUtilsMock = {
  ENTITLED_SUBSCRIPTION_STATUSES,
  USABLE_SUBSCRIPTION_STATUSES,
  TERMINAL_SUBSCRIPTION_STATUSES,
  hasPaidSubscriptionStatus: billingSubscriptionUtilsMockFns.mockHasPaidSubscriptionStatus,
  hasUsableSubscriptionStatus: billingSubscriptionUtilsMockFns.mockHasUsableSubscriptionStatus,
  hasUsableSubscriptionAccess: billingSubscriptionUtilsMockFns.mockHasUsableSubscriptionAccess,
  getFreeTierLimit: billingSubscriptionUtilsMockFns.mockGetFreeTierLimit,
  getProTierLimit: billingSubscriptionUtilsMockFns.mockGetProTierLimit,
  getTeamTierLimitPerSeat: billingSubscriptionUtilsMockFns.mockGetTeamTierLimitPerSeat,
  getEnterpriseTierLimitPerSeat: billingSubscriptionUtilsMockFns.mockGetEnterpriseTierLimitPerSeat,
  checkEnterprisePlan: billingSubscriptionUtilsMockFns.mockCheckEnterprisePlan,
  getEffectiveSeats: billingSubscriptionUtilsMockFns.mockGetEffectiveSeats,
  checkProPlan: billingSubscriptionUtilsMockFns.mockCheckProPlan,
  checkTeamPlan: billingSubscriptionUtilsMockFns.mockCheckTeamPlan,
  checkOrgPlan: billingSubscriptionUtilsMockFns.mockCheckOrgPlan,
  isOrgScopedSubscription: billingSubscriptionUtilsMockFns.mockIsOrgScopedSubscription,
  getPerUserMinimumLimit: billingSubscriptionUtilsMockFns.mockGetPerUserMinimumLimit,
  canEditUsageLimit: billingSubscriptionUtilsMockFns.mockCanEditUsageLimit,
  getPlanPricing: billingSubscriptionUtilsMockFns.mockGetPlanPricing,
}
