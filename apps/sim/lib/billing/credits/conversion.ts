/**
 * Credit conversion utilities.
 * All DB values remain in dollars; these helpers convert at API/UI boundaries only.
 * 1 credit = $0.005 (i.e. $1 = 200 credits)
 */

import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'

export const CREDIT_MULTIPLIER = 200

export function dollarsToCredits(dollars: number): number {
  return Math.round(dollars * CREDIT_MULTIPLIER)
}

/**
 * Format a dollar amount as a comma-separated credit string.
 * Values at or above the on-demand unlimited threshold display as ∞.
 * @example formatCredits(20) => "2,000"
 * @example formatCredits(999999) => "∞"
 */
export function formatCredits(dollars: number): string {
  if (dollars >= ON_DEMAND_UNLIMITED) return '∞'
  return dollarsToCredits(dollars).toLocaleString()
}
