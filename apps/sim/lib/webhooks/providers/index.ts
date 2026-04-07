export { getProviderHandler } from '@/lib/webhooks/providers/registry'
export type {
  AuthContext,
  EventFilterContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  ProcessFilesContext,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

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
