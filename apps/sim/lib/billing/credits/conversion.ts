/**
 * Credit conversion utilities.
 * All DB values remain in dollars; these helpers convert at API/UI boundaries only.
 * 1 credit = $0.005 (i.e. $1 = 200 credits)
 */

export const CREDIT_MULTIPLIER = 200

export function dollarsToCredits(dollars: number): number {
  return Math.round(dollars * CREDIT_MULTIPLIER)
}

/**
 * Format a dollar amount as a comma-separated credit string.
 * @example formatCredits(20) => "2,000"
 */
export function formatCredits(dollars: number): string {
  return dollarsToCredits(dollars).toLocaleString()
}
