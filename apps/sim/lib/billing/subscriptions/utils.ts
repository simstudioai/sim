import { toRecord } from '@sim/utils/object'
import {
  DEFAULT_ENTERPRISE_TIER_COST_LIMIT,
  DEFAULT_FREE_CREDITS,
  DEFAULT_PRO_TIER_COST_LIMIT,
  DEFAULT_TEAM_TIER_COST_LIMIT,
  PRO_TRIAL_USAGE_LIMIT_DOLLARS,
} from '@/lib/billing/constants'
import { CREDIT_MULTIPLIER } from '@/lib/billing/credits/conversion'
import { configuredEnterpriseUsageCredits } from '@/lib/billing/enterprise-credit-limits'
import {
  getPlanTierCredits,
  getPlanWeeklyRefreshDollars,
  isEnterprise,
  isFree,
  isOrgPlan,
  isPaid,
  isPro,
  isTeam,
} from '@/lib/billing/plan-helpers'
import { parseEnterpriseSubscriptionMetadata } from '@/lib/billing/types'
import { env, envNumber } from '@/lib/core/config/env'

/**
 * Statuses that hold a paid plan's entitlement. `trialing` is a free trial of a paid plan: it gets
 * the plan's features under a capped allowance (see {@link isTrialingSubscription}).
 */
export const ENTITLED_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const

export const USABLE_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const

/**
 * Statuses whose billing periods Sim settles (cycle close, overage). A `trialing` period is left
 * out: Stripe charges nothing for it and its usage is capped, so it never owes overage, and its
 * close marker initializes on the first paid period instead.
 */
export const SETTLED_SUBSCRIPTION_STATUSES = ['active', 'past_due'] as const

/**
 * Statuses where the subscription is finished and can no longer bill anyone.
 *
 * The inverse of this set — `active`, `past_due`, `unpaid`, `trialing`,
 * `incomplete` — is still attached to a live Stripe subscription that can
 * convert or retry, even where it grants no entitlement today. Use this, not
 * {@link ENTITLED_SUBSCRIPTION_STATUSES}, when the question is "would removing
 * the thing this row points at strand live billing?" — an `incomplete` or
 * `unpaid` subscription is unentitled but very much alive.
 *
 * Deliberately expressed as the terminal set rather than the live one, so a
 * status Stripe adds later is treated as live by default. For a destructive
 * operation that is the safe direction to be wrong in.
 */
export const TERMINAL_SUBSCRIPTION_STATUSES = ['canceled', 'incomplete_expired'] as const

/**
 * Whether the subscription is in its free trial. A trial has the plan's features but spends a
 * fixed allowance ({@link PRO_TRIAL_USAGE_LIMIT_DOLLARS}) with no weekly refresh, no on-demand
 * usage, and no overage billing.
 */
export function isTrialingSubscription(
  subscription: { status?: string | null } | null | undefined
): boolean {
  return subscription?.status === 'trialing'
}

/** A trial's end date as billing emails state it, in UTC so every recipient reads the same day. */
export function formatTrialEndDate(trialEnd: Date): string {
  return trialEnd.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Whether a payer's limit admits spend past it: a paid plan outside its trial. Every other payer's
 * limit is a hard cap. Whether that spend is then invoiced is {@link invoicesOverage}.
 */
export function billsOverage(
  subscription: { plan?: string | null; status?: string | null } | null | undefined
): boolean {
  return isPaid(subscription?.plan) && !isTrialingSubscription(subscription)
}

/**
 * Whether Enterprise subscription metadata opts the contract into self-serve billing. Self-serve
 * overage closes on Stripe billing periods and seats past the contract are billed at its seat
 * rate, so metadata that still carries a reporting-period anchor, or has no seat rate, fails
 * closed to the hard-capped contract until an admin fixes it.
 */
export function isSelfServeEnterpriseMetadata(metadata: unknown): boolean {
  const terms = parseEnterpriseSubscriptionMetadata(metadata)
  return (
    terms?.selfServe === true &&
    terms.seatPriceCents !== undefined &&
    terms.reportingPeriodAnchorDate === undefined
  )
}

/** Whether a subscription is an Enterprise contract opted into self-serve billing. */
export function isEnterpriseSelfServe(
  subscription: { plan?: string | null; metadata?: unknown } | null | undefined
): boolean {
  return isEnterprise(subscription?.plan) && isSelfServeEnterpriseMetadata(subscription?.metadata)
}

/**
 * Whether a subscription is an Enterprise contract outside self-serve: its seats and usage limit
 * are hard caps the flat contract price covers, and it never bills overage.
 */
export function isHardCappedEnterprise(
  subscription: { plan?: string | null; metadata?: unknown } | null | undefined
): boolean {
  return isEnterprise(subscription?.plan) && !isSelfServeEnterpriseMetadata(subscription?.metadata)
}

/** Whether spend past the plan's included usage is invoiced as overage. */
export function invoicesOverage(
  subscription:
    | { plan?: string | null; status?: string | null; metadata?: unknown }
    | null
    | undefined
): boolean {
  return billsOverage(subscription) && !isHardCappedEnterprise(subscription)
}

/**
 * The usage an organization subscription includes each period, in dollars, before overage: the
 * Enterprise contract allowance, or the plan's base price per seat.
 */
export function getOrgIncludedUsageDollars(subscription: {
  plan?: string | null
  seats?: number | null
  metadata?: unknown
}): number {
  if (isEnterprise(subscription.plan)) {
    const metadata = parseEnterpriseSubscriptionMetadata(subscription.metadata)
    if (!metadata) return 0
    return (
      configuredEnterpriseUsageCredits(
        toRecord(subscription.metadata).usageLimitCredits,
        metadata.invoiceAmountUsd
      ) / CREDIT_MULTIPLIER
    )
  }
  return (subscription.seats || 1) * getPlanPricing(subscription.plan ?? '').basePrice
}

/** What a self-serve Enterprise contract commits to, for the surfaces that explain its billing. */
export interface EnterpriseSelfServeTerms {
  /** Seats the contract price covers; members past it are trued up. */
  contractSeats: number
  /** The rate for each seat past the contract, in cents per seat per month. */
  seatPriceCents: number
  /** Usage the contract includes each billing period, in dollars, before overage. */
  includedUsage: number
}

/** A subscription's self-serve Enterprise terms, or null when it is not a self-serve contract. */
export function getEnterpriseSelfServeTerms(subscription: {
  plan?: string | null
  seats?: number | null
  metadata?: unknown
}): EnterpriseSelfServeTerms | null {
  if (!isEnterpriseSelfServe(subscription)) return null
  const metadata = parseEnterpriseSubscriptionMetadata(subscription.metadata)
  return {
    contractSeats: metadata?.seats ?? 0,
    seatPriceCents: metadata?.seatPriceCents ?? 0,
    includedUsage: getOrgIncludedUsageDollars(subscription),
  }
}

/**
 * The weekly refresh allowance a subscription earns, in dollars per seat per week: the plan's
 * allowance, or nothing during a trial.
 */
export function getSubscriptionWeeklyRefreshDollars(
  subscription: { plan?: string | null; status?: string | null } | null | undefined
): number {
  if (isTrialingSubscription(subscription)) return 0
  return getPlanWeeklyRefreshDollars(subscription?.plan)
}

/**
 * Returns true when a subscription should still count as a paid plan entitlement.
 */
export function hasPaidSubscriptionStatus(status: string | null | undefined): boolean {
  return ENTITLED_SUBSCRIPTION_STATUSES.includes(
    status as (typeof ENTITLED_SUBSCRIPTION_STATUSES)[number]
  )
}

/**
 * Returns true when a subscription status is usable for product access.
 */
export function hasUsableSubscriptionStatus(status: string | null | undefined): boolean {
  return USABLE_SUBSCRIPTION_STATUSES.includes(
    status as (typeof USABLE_SUBSCRIPTION_STATUSES)[number]
  )
}

/**
 * Returns true when a subscription is usable for product access.
 */
export function hasUsableSubscriptionAccess(
  status: string | null | undefined,
  billingBlocked: boolean | null | undefined
): boolean {
  return hasUsableSubscriptionStatus(status) && !billingBlocked
}

/**
 * Get the free tier limit from env or fallback to default
 */
export function getFreeTierLimit(): number {
  return envNumber(env.FREE_TIER_COST_LIMIT, DEFAULT_FREE_CREDITS)
}

/**
 * The free allowance one user actually receives: the free tier limit, or zero
 * when `user_stats.free_tier_eligible` is false because the account reuses the
 * identity of a recently deleted one (see `lib/users/deleted-identity`).
 */
export function getFreeTierAllowance(freeTierEligible: boolean): number {
  return freeTierEligible ? getFreeTierLimit() : 0
}

/**
 * Get the pro tier limit from env or fallback to default
 */
export function getProTierLimit(): number {
  return envNumber(env.PRO_TIER_COST_LIMIT, DEFAULT_PRO_TIER_COST_LIMIT)
}

/**
 * Get the team tier limit per seat from env or fallback to default
 */
export function getTeamTierLimitPerSeat(): number {
  return envNumber(env.TEAM_TIER_COST_LIMIT, DEFAULT_TEAM_TIER_COST_LIMIT)
}

/**
 * Get the enterprise tier limit per seat from env or fallback to default
 */
export function getEnterpriseTierLimitPerSeat(): number {
  return envNumber(env.ENTERPRISE_TIER_COST_LIMIT, DEFAULT_ENTERPRISE_TIER_COST_LIMIT)
}

export function checkEnterprisePlan(subscription: any): boolean {
  return isEnterprise(subscription?.plan) && hasPaidSubscriptionStatus(subscription?.status)
}

export function getEffectiveSeats(subscription: any): number {
  if (!subscription) {
    return 0
  }

  if (isEnterprise(subscription.plan)) {
    const metadata = parseEnterpriseSubscriptionMetadata(subscription.metadata)
    if (metadata) {
      return metadata.seats
    }
    return 0
  }

  // Mirrors the Stripe subscription's `quantity`. For personal Pro this
  // is null in practice, so `?? 0` returns 0. For Team, fall back to 1
  // while the seat value has not yet been synced from Stripe so invite
  // and seat-validation flows don't transiently read as zero seats.
  if (isTeam(subscription.plan)) {
    return subscription.seats ?? (hasPaidSubscriptionStatus(subscription.status) ? 1 : 0)
  }

  if (isPro(subscription.plan)) {
    return subscription.seats ?? 0
  }

  return 0
}

export function checkProPlan(subscription: any): boolean {
  return isPro(subscription?.plan) && hasPaidSubscriptionStatus(subscription?.status)
}

export function checkTeamPlan(subscription: any): boolean {
  return isTeam(subscription?.plan) && hasPaidSubscriptionStatus(subscription?.status)
}

/**
 * True when the subscription is a paying organization plan — Pro for Teams,
 * Max for Teams, or Enterprise. The single predicate for features every
 * organization gets, as opposed to {@link checkEnterprisePlan}, which gates the
 * Enterprise-only tier.
 */
export function checkOrgPlan(subscription: any): boolean {
  return isOrgPlan(subscription?.plan) && hasPaidSubscriptionStatus(subscription?.status)
}

/**
 * True when the subscription's `referenceId` is an org (i.e. not the
 * caller's own `userId`). Prefer this over plan-name checks for scope
 * decisions — a `pro_*` sub attached to an org is org-scoped even though
 * `isTeam` / `isOrgPlan` return false.
 */
export function isOrgScopedSubscription(
  subscription: { referenceId?: string | null } | null | undefined,
  userId: string
): boolean {
  if (!subscription?.referenceId) return false
  return subscription.referenceId !== userId
}

/**
 * Get the minimum usage limit for an individual user (used for validation).
 *
 * Callers should only invoke this for **personally-scoped** subscriptions —
 * any org-scoped subscription (team, enterprise, or `pro_*` attached to an
 * organization) uses the organization-level limit instead. Callers are
 * responsible for gating with `isOrgScopedSubscription` before calling.
 *
 * @param subscription The subscription object
 * @param freeTierEligible The user's `user_stats.free_tier_eligible`, which
 *   decides the floor when there is no paid subscription
 * @returns The per-user minimum limit in dollars
 */
export function getPerUserMinimumLimit(subscription: any, freeTierEligible: boolean): number {
  if (!subscription || !hasPaidSubscriptionStatus(subscription.status)) {
    return getFreeTierAllowance(freeTierEligible)
  }

  if (isTrialingSubscription(subscription)) return PRO_TRIAL_USAGE_LIMIT_DOLLARS

  if (isPro(subscription.plan)) {
    const tierCredits = getPlanTierCredits(subscription.plan)
    if (tierCredits > 0) return tierCredits / CREDIT_MULTIPLIER
    return getProTierLimit()
  }

  if (isOrgPlan(subscription.plan)) {
    return 0
  }

  return getFreeTierAllowance(freeTierEligible)
}

/**
 * Whether a subscription's usage limit is customer-editable: Pro, Team, or self-serve Enterprise,
 * active and outside a trial.
 */
export function canEditUsageLimit(subscription: any): boolean {
  if (!subscription || !hasUsableSubscriptionStatus(subscription.status)) {
    return false // Free plan users cannot edit limits
  }

  if (isTrialingSubscription(subscription)) return false

  return (
    isPro(subscription.plan) || isTeam(subscription.plan) || isEnterpriseSelfServe(subscription)
  )
}

/**
 * Get pricing info for a plan. Supports both legacy names (`'pro'`, `'team'`)
 * and new credit-tier names (`'pro_4000'`, `'team_8000'`).
 */
export function getPlanPricing(plan: string): { basePrice: number } {
  if (isFree(plan)) return { basePrice: 0 }
  if (isEnterprise(plan)) return { basePrice: getEnterpriseTierLimitPerSeat() }

  if (isPro(plan) || isTeam(plan)) {
    const tierCredits = getPlanTierCredits(plan)
    if (tierCredits > 0) return { basePrice: tierCredits / CREDIT_MULTIPLIER }
    return { basePrice: isPro(plan) ? getProTierLimit() : getTeamTierLimitPerSeat() }
  }

  return { basePrice: 0 }
}
