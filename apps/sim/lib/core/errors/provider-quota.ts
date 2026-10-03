/**
 * True when a provider rejection body reports an exhausted balance rather than a rate
 * limit. OpenAI returns 429 for both, but only a rate limit reopens: a spent account
 * stands until someone adds credit, so retrying it cannot succeed.
 */
export function isQuotaExhaustionBody(errorText: string): boolean {
  try {
    const body = JSON.parse(errorText) as { error?: { type?: string; code?: string } }
    const type = body.error?.type
    const code = body.error?.code
    return (
      type === 'insufficient_quota' ||
      code === 'insufficient_quota' ||
      code === 'credit_balance_exhausted'
    )
  } catch {
    return false
  }
}
