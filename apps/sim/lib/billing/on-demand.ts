/**
 * On-demand toggle math for the billing settings toggle.
 *
 * DB values are dollars; these helpers operate on dollars and are the single
 * source of truth for what "on-demand on" means.
 */

/**
 * The maximum usage that is never billed: the plan's included allowance
 * (`planBase`) plus any goodwill credit balance. `setUsageLimitForCredits` raises
 * the usage limit to exactly this value when credits are granted, so the stored
 * limit already reflects the credits.
 */
export function getCoveredUsage(planIncludedAmount: number, creditBalance: number): number {
  return planIncludedAmount + creditBalance
}

/**
 * Whether on-demand (past-included) usage is enabled: the usage limit sits above
 * the covered ceiling. Only meaningful for a paid plan with a positive included
 * allowance. Comparing against `covered` — not `planIncludedAmount` alone — is
 * what keeps a credit grant, which raises the limit to `planBase + creditBalance`,
 * from being misread as on-demand having been switched on.
 */
export function getIsOnDemandActive(params: {
  isPaid: boolean
  planIncludedAmount: number
  effectiveUsageLimit: number
  covered: number
}): boolean {
  const { isPaid, planIncludedAmount, effectiveUsageLimit, covered } = params
  if (!isPaid || planIncludedAmount <= 0) return false
  return effectiveUsageLimit > covered
}

/**
 * The usage limit to persist when turning on-demand OFF: drop back to the covered
 * ceiling, but never below current usage — lowering the limit under usage would
 * retroactively put the account over its cap. When usage already exceeds covered
 * the limit lands on current usage and the toggle stays on until usage resets;
 * that is an accepted edge, never a blocked action.
 */
export function getOnDemandOffLimit(currentUsage: number, covered: number): number {
  return Math.max(currentUsage, covered)
}

/**
 * Whether the on-demand toggle should render disabled: it is on, but usage has
 * already passed the covered ceiling, so turning it off would only re-cap the
 * limit at current usage ({@link getOnDemandOffLimit}) and the control would
 * spring straight back on. The UI disables it with an explanatory tooltip rather
 * than accepting a no-op click. The state clears on its own once usage drops back
 * to or below covered (e.g. at the next billing reset).
 */
export function isOnDemandOffDisabled(params: {
  isOnDemandActive: boolean
  effectiveCurrentUsage: number
  covered: number
}): boolean {
  const { isOnDemandActive, effectiveCurrentUsage, covered } = params
  return isOnDemandActive && effectiveCurrentUsage > covered
}
