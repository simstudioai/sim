/**
 * Billing and cost constants shared between client and server code
 */

/**
 * Fallback free credits (in dollars) when env var is not set
 */
export const DEFAULT_FREE_CREDITS = 20

/**
 * Default per-user minimum limits (in dollars) for paid plans when env vars are absent
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
export const DEFAULT_OVERAGE_THRESHOLD = 50

/**
 * Available credit tiers. Each tier maps a credit amount to the underlying dollar cost.
 * 1 credit = $0.01, so credits = dollars * 100.
 */
export const CREDIT_TIERS = [
  { credits: 2000, dollars: 20 },
  { credits: 4000, dollars: 40 },
  { credits: 6000, dollars: 60 },
  { credits: 8000, dollars: 80 },
  { credits: 10000, dollars: 100 },
  { credits: 12000, dollars: 120 },
  { credits: 14000, dollars: 140 },
  { credits: 16000, dollars: 160 },
  { credits: 18000, dollars: 180 },
  { credits: 20000, dollars: 200 },
] as const

export type CreditTier = (typeof CREDIT_TIERS)[number]

/**
 * Weekly refresh rate: 1% of plan cost per day, accumulated over 7 days.
 * E.g. $20 plan => $0.20/day => $1.40/week included usage.
 */
export const WEEKLY_REFRESH_RATE = 0.07

/**
 * Annual subscribers pay 15% less than the equivalent monthly plan
 * but receive the same included credits. The Stripe annual price is
 * `monthlyDollars * 12 * (1 - ANNUAL_DISCOUNT_RATE)`.
 */
export const ANNUAL_DISCOUNT_RATE = 0.15
