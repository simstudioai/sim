import type { WebhookDispatchResult } from '@/lib/webhooks/processor'

/**
 * A target that dropped the delivery for good: its trigger block is gone, or it
 * acknowledged a deterministic admission refusal. In a fan-out it answers the
 * sender with 200 only when no other target needs a retry.
 */
export function isDroppedDispatch(result: Pick<WebhookDispatchResult, 'reason'>): boolean {
  return result.reason === 'block-missing' || result.reason === 'admission-rejected'
}
