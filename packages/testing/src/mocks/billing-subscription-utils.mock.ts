import { vi } from 'vitest'
import {
  CREDIT_MULTIPLIER,
  DEFAULT_ENTERPRISE_TIER_COST_LIMIT,
  DEFAULT_FREE_CREDITS,
  DEFAULT_PRO_TIER_COST_LIMIT,
  DEFAULT_TEAM_TIER_COST_LIMIT,
  getPlanPricing,
  getPlanTierCredits,
  isEnterprise,
  isOrgPlan,
  isPro,
  isTeam,
} from './billing-plan-logic'

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

/** Mirrors `MAX_BILLING_CONCURRENCY_LIMIT` in `@/lib/billing/concurrency-defaults`. */
const MAX_BILLING_CONCURRENCY_LIMIT = 10_000

/** `z.coerce.number()` followed by the schema's `int`/`positive`/`max` checks. */
function isCoercedPositiveNumber(
  value: unknown,
  options: { integer?: boolean; max?: number } = {}
): boolean {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return false
  if (options.integer && !Number.isSafeInteger(n)) return false
  return options.max === undefined || n <= options.max
}

function isValidReportingPeriodAnchorDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value &&
    parsed.getTime() <= Date.now()
  )
}

/**
 * Port of `parseEnterpriseSubscriptionMetadata(...).seats` from `@/lib/billing/types`: returns
 * 0 wherever the real zod schema rejects the metadata — `plan` must be `enterprise` (any case),
 * `referenceId` non-empty, `seats` a positive integer, `invoiceAmountCents` (positive integer)
 * or `monthlyPrice` (positive) present, and each optional `reportingPeriodAnchorDate` (a real,
 * non-future `YYYY-MM-DD`), `reportingPeriodInterval` (`month`/`year`), and `concurrencyLimit`
 * (positive integer up to 10,000) valid when present. `workflowExecutionTimeoutSeconds` never
 * rejects: the real schema maps an invalid value to `undefined`.
 */
function enterpriseSeats(metadata: unknown): number {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return 0
  const m = metadata as Record<string, unknown>
  if (typeof m.plan !== 'string' || m.plan.toLowerCase() !== 'enterprise') return 0
  if (typeof m.referenceId !== 'string' || m.referenceId.length === 0) return 0
  if (m.invoiceAmountCents === undefined && m.monthlyPrice === undefined) return 0
  if (
    m.invoiceAmountCents !== undefined &&
    !isCoercedPositiveNumber(m.invoiceAmountCents, { integer: true })
  ) {
    return 0
  }
  if (m.monthlyPrice !== undefined && !isCoercedPositiveNumber(m.monthlyPrice)) return 0
  if (!isCoercedPositiveNumber(m.seats, { integer: true })) return 0
  if (
    m.reportingPeriodAnchorDate !== undefined &&
    !isValidReportingPeriodAnchorDate(m.reportingPeriodAnchorDate)
  ) {
    return 0
  }
  if (
    m.reportingPeriodInterval !== undefined &&
    m.reportingPeriodInterval !== 'month' &&
    m.reportingPeriodInterval !== 'year'
  ) {
    return 0
  }
  if (
    m.concurrencyLimit !== undefined &&
    !isCoercedPositiveNumber(m.concurrencyLimit, {
      integer: true,
      max: MAX_BILLING_CONCURRENCY_LIMIT,
    })
  ) {
    return 0
  }
  return Number(m.seats)
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

/**
 * Controllable mock functions for `@/lib/billing/subscriptions/utils`.
 *
 * Every export is a pure helper, so every fn defaults to a faithful port of the real logic
 * (status predicates, `check*Plan`, `isOrgScopedSubscription`, `getEffectiveSeats`,
 * `getPerUserMinimumLimit`, `canEditUsageLimit`, `getPlanPricing`). The tier-limit getters
 * return the `@/lib/billing/constants` defaults (free 5, pro 20, team 40, enterprise 200)
 * because the env overrides are unset under test. `getEffectiveSeats` reads Enterprise seats
 * through a port of the real metadata validation (see `enterpriseSeats`). The plan predicates
 * and `getPlanPricing` are shared with the billing-core mock via `./billing-plan-logic`.
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
