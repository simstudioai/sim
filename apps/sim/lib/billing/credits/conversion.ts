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
 * Single source of truth for rendering a dollar cost as a credit label.
 *
 * Both the billing cost breakdown and the trace view derive their credit
 * strings from here so the two surfaces can never diverge in rounding,
 * thresholds, or pluralization. The dollar amount passed in is expected to
 * already carry any cost multiplier (the value is converted with one — and
 * only one — round via `dollarsToCredits`, i.e. multiply-then-round; never
 * round per-line then multiply).
 *
 * `emptyForZeroOrLess` controls the zero/empty behavior so existing call sites
 * keep their contracts: the breakdown wants a concrete "0 credits"/"—" string,
 * the trace view wants `undefined` so it can hide the chip entirely.
 */
export function formatCreditCost(
  dollars: number | null | undefined,
  opts?: { emptyForZeroOrLess?: boolean }
): string | undefined {
  if (dollars === undefined || dollars === null || !Number.isFinite(dollars)) {
    return opts?.emptyForZeroOrLess ? undefined : '—'
  }

  const credits = dollarsToCredits(dollars)

  if (credits <= 0) {
    if (dollars > 0) return '<1 credit'
    return opts?.emptyForZeroOrLess ? undefined : '0 credits'
  }

  return `${credits.toLocaleString()} ${credits === 1 ? 'credit' : 'credits'}`
}

/**
 * Splits a set of cost components into integer credits that sum *exactly* to
 * the credits of their combined total.
 *
 * This is the fix for the "line items don't add up to the total" class of bug:
 * rounding each line independently (round-then-sum) drifts from the real charge
 * (e.g. 1 + 2 + 1 = 4, or 1 + 4 + 2 = 7, when the true total is 6). Instead we
 * convert the *summed* dollars to credits with a single round (multiply-then-
 * round) and distribute that figure across the components via the largest-
 * remainder method, so every component is multiplier-applied, internally
 * consistent, and the rows always reconcile with the total.
 *
 * Each component's `dollars` is expected to already include any cost multiplier.
 */
export function apportionCredits<K extends string>(
  components: { key: K; dollars: number }[]
): Record<K, number> {
  const result = {} as Record<K, number>

  const sanitized = components.map((c) => ({
    key: c.key,
    dollars: Number.isFinite(c.dollars) && c.dollars > 0 ? c.dollars : 0,
  }))

  const totalDollars = sanitized.reduce((sum, c) => sum + c.dollars, 0)
  const targetCredits = dollarsToCredits(totalDollars)

  const exact = sanitized.map((c) => ({
    key: c.key,
    floor: Math.floor(c.dollars * CREDIT_MULTIPLIER),
    frac: c.dollars * CREDIT_MULTIPLIER - Math.floor(c.dollars * CREDIT_MULTIPLIER),
  }))

  for (const c of exact) result[c.key] = c.floor

  let remainder = targetCredits - exact.reduce((sum, c) => sum + c.floor, 0)
  const byFraction = [...exact].sort((a, b) => b.frac - a.frac)
  for (let i = 0; i < byFraction.length && remainder > 0; i++) {
    result[byFraction[i].key] += 1
    remainder--
  }

  return result
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
