export { getProviderHandler } from '@/lib/webhooks/providers/registry'

import { getProviderHandler } from '@/lib/webhooks/providers/registry'
import { isInternalTriggerProvider, isPollingWebhookProvider } from '@/triggers/constants'

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

/**
 * Whether a provider accepts deliveries through the generic per-webhook path route.
 *
 * False for triggers Sim fires itself - internal (table row, workspace events) and polling
 * (pulled from `/api/webhooks/poll/[provider]`) - and for providers that own an app-level
 * ingress route: their rows still register a path but declare no `verifyAuth`, so anyone
 * holding the block ID could otherwise forge events.
 */
export function acceptsPathWebhookDelivery(provider: string | null): boolean {
  if (!provider) return true
  if (isInternalTriggerProvider(provider) || isPollingWebhookProvider(provider)) return false
  return getProviderHandler(provider).ingressMode !== 'provider'
}
