/**
 * Billing and cost constants shared between client and server code
 */

/**
 * Fallback free credits (in dollars) when env var is not set
 */
export const DEFAULT_FREE_CREDITS = 5

/**
 * Default per-user minimum limits (in dollars) for paid plans when env vars are absent.
 * These are intentionally kept at legacy pricing ($20 Pro, $40 Team) for backward
 * compatibility with existing subscribers on the old plan names ('pro', 'team').
 * New tiered plans (pro_6000, team_25000, etc.) derive their limits from CREDIT_TIERS.
 */
export const DEFAULT_PRO_TIER_COST_LIMIT = 20
export const DEFAULT_TEAM_TIER_COST_LIMIT = 40
export const DEFAULT_ENTERPRISE_TIER_COST_LIMIT = 200

/**
 * Base charge applied to every workflow execution
 * This charge is applied regardless of whether the workflow uses AI models
 */
export const BASE_EXECUTION_CHARGE = 0.005

/**
 * Fixed cost for search tool invocation (in dollars)
 */
export const SEARCH_TOOL_COST = 0.01

/**
 * Default threshold (in dollars) for incremental overage billing
 * When unbilled overage reaches this amount, an invoice item is created
 */
export const DEFAULT_OVERAGE_THRESHOLD = 100

/**
 * Maximum time to wait on billing coordination row locks before retrying later.
 */
export const BILLING_LOCK_TIMEOUT_MS = 5_000

/**
 * Available credit tiers. Each tier maps a credit amount to the underlying dollar cost.
 * 1 credit = $0.005, so credits = dollars * 200.
 */
const PRO_CREDIT_TIER = { credits: 6000, dollars: 25, name: 'Pro' } as const
const MAX_CREDIT_TIER = { credits: 25000, dollars: 100, name: 'Max' } as const

export const CREDIT_TIERS = [PRO_CREDIT_TIER, MAX_CREDIT_TIER] as const

export type CreditTier = (typeof CREDIT_TIERS)[number]

/**
 * Credit allocation at which a paid plan enters the Max tier.
 *
 * Derived from the tier table above so the threshold can never drift from it.
 * Do not re-spell this number: every "is this Max?" decision goes through
 * `isMaxTier` in `@/lib/billing/plan-helpers`, which reads this constant. The
 * server feature gates and the client `hasUsableMaxAccess` derivation share that
 * predicate precisely so the UI can never offer a feature the API refuses.
 */
export const MAX_TIER_CREDITS = MAX_CREDIT_TIER.credits

/**
 * Credits granted per dollar of plan spend. A credit is $0.005, so a dollar
 * buys 200 — the conversion behind both free-tier and daily-refresh credits.
 */
export const CREDITS_PER_DOLLAR = 200

/**
 * Daily refresh rate: 1% of plan cost per day.
 * E.g. $25 plan => $0.25/day => 50 credits/day included usage.
 */
export const DAILY_REFRESH_RATE = 0.01

/**
 * Annual subscribers pay 15% less than the equivalent monthly plan
 * but receive the same included credits. The Stripe annual price is
 * `monthlyDollars * 12 * (1 - ANNUAL_DISCOUNT_RATE)`.
 */
export const ANNUAL_DISCOUNT_RATE = 0.15

/**
 * Dollar value used as the usage limit when on-demand billing is enabled.
 * Effectively unlimited — any limit >= this threshold is treated as uncapped.
 */
export const ON_DEMAND_UNLIMITED = 999999
