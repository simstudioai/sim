/**
 * Credit → dollar valuation for on-prem usage reports (receiving side).
 *
 * Credits are the stored fact; dollars are derived here at read time from the
 * rate in effect at a report's `periodStart`. That fixes the semantics of a
 * rate change:
 *
 * - A new rate with `effectiveFrom` = now applies to periods starting from now
 *   on. Every earlier period keeps the rate that covered it.
 * - A rate inserted with an earlier `effectiveFrom` (a backdated correction)
 *   re-values the periods from that instant onward the next time they are
 *   read. No stored credit figure changes.
 * - A period that starts before the deployment's first rate has no dollar
 *   value (`usd: null`) rather than a guessed one.
 *
 * Rates are append-only, so the history of what was charged when is always
 * reconstructible from the rate table alone.
 */

export interface EffectiveRate {
  id: string
  usdPerCredit: number
  effectiveFrom: Date
  createdAt: Date
}

/**
 * The rate in effect at `at`: the latest `effectiveFrom` that is not after
 * `at`. Two rates sharing an `effectiveFrom` resolve to the one created last,
 * so a correction entered later wins.
 */
export function resolveRateAt(rates: readonly EffectiveRate[], at: Date): EffectiveRate | null {
  let winner: EffectiveRate | null = null
  for (const rate of rates) {
    if (rate.effectiveFrom.getTime() > at.getTime()) continue
    if (
      !winner ||
      rate.effectiveFrom.getTime() > winner.effectiveFrom.getTime() ||
      (rate.effectiveFrom.getTime() === winner.effectiveFrom.getTime() &&
        rate.createdAt.getTime() > winner.createdAt.getTime())
    ) {
      winner = rate
    }
  }
  return winner
}

/** Dollars for `credits` at `rate`, to the nearest micro-dollar; `null` without a rate. */
export function creditsToUsd(credits: number, rate: EffectiveRate | null): number | null {
  if (!rate) return null
  return Math.round(credits * rate.usdPerCredit * 1e6) / 1e6
}

export interface ValuedUsage<T> {
  row: T
  rate: EffectiveRate | null
  usd: number | null
}

/** Attaches the applicable rate and derived dollars to each usage row. */
export function valueUsage<T extends { periodStart: Date; credits: number }>(
  rows: readonly T[],
  rates: readonly EffectiveRate[]
): ValuedUsage<T>[] {
  return rows.map((row) => {
    const rate = resolveRateAt(rates, row.periodStart)
    return { row, rate, usd: creditsToUsd(row.credits, rate) }
  })
}
