export { getProviderHandler } from '@/lib/webhooks/providers/registry'

import { toRecord } from '@sim/utils/object'
import { getProviderHandler } from '@/lib/webhooks/providers/registry'
import { isProviderConfigFlagEnabled } from '@/lib/webhooks/providers/utils'
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

/**
 * Whether this webhook accepts a delivery arriving with this HTTP method.
 *
 * Every webhook accepts `POST`. Anything else needs both a provider that declares the method in
 * `extraDeliveryMethods` and the webhook itself opting in through the flag that declaration
 * names. Requiring both is what keeps the capability from changing the behavior of a webhook
 * deployed before it existed: such a row has no flag, so it keeps answering `405`.
 */
export function acceptsWebhookDeliveryMethod(
  provider: string | null,
  method: string,
  providerConfig: unknown
): boolean {
  if (method === 'POST') return true
  if (!provider) return false

  const extra = getProviderHandler(provider).extraDeliveryMethods
  if (!extra?.methods.includes(method)) return false

  return isProviderConfigFlagEnabled(toRecord(providerConfig)[extra.enabledBy])
}
