import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { creditsToDollars, dollarsToCredits } from '@/lib/billing/credits/conversion'

/** Whether a typed limit, in credits, differs from the saved limit, in dollars. */
export function isUsageLimitDraftDirty(draft: string, currentLimit: number): boolean {
  return draft.trim() === ''
    ? currentLimit < ON_DEMAND_UNLIMITED
    : Number.parseFloat(draft) !== dollarsToCredits(currentLimit)
}

type UsageLimitDraftDecision =
  /** A cleared field while a limit is set: it saves nothing until something is typed. */
  | { kind: 'wait' }
  /** The draft already matches what is saved. */
  | { kind: 'settled' }
  | { kind: 'invalid'; message: string }
  | { kind: 'save'; limitDollars: number }

/** What a settled usage-limit draft should do. The input is credits; storage is dollars. */
export function resolveUsageLimitDraft(
  draft: string,
  currentLimit: number,
  minimumLimit: number
): UsageLimitDraftDecision {
  if (draft.trim() === '') {
    return currentLimit >= ON_DEMAND_UNLIMITED ? { kind: 'settled' } : { kind: 'wait' }
  }
  const credits = Number.parseFloat(draft)
  if (Number.isNaN(credits)) return { kind: 'invalid', message: 'Usage limit must be a number' }
  if (credits === dollarsToCredits(currentLimit)) return { kind: 'settled' }
  const minimumCredits = dollarsToCredits(minimumLimit)
  if (credits < minimumCredits) {
    return {
      kind: 'invalid',
      message: `Usage limit must be at least ${minimumCredits.toLocaleString()} credits`,
    }
  }
  return { kind: 'save', limitDollars: creditsToDollars(credits) }
}
