export { getProviderHandler } from '@/lib/webhooks/providers/registry'

import { getProviderHandler } from '@/lib/webhooks/providers/registry'

/**
 * Extract a provider-specific unique identifier from the webhook body for idempotency.
 */
export function extractProviderIdentifierFromBody(provider: string, body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const handler = getProviderHandler(provider)
  return handler.extractIdempotencyId?.(body) ?? null
}

/** Returns whether a provider accepts deliveries through the generic per-webhook path route. */
export function acceptsPathWebhookDelivery(provider: string | null): boolean {
  if (!provider) return true
  return getProviderHandler(provider).ingressMode !== 'provider'
}
