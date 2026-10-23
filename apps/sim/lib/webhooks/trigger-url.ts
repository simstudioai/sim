import { getBaseUrl } from '@/lib/core/utils/urls'

/**
 * The public URL an external system POSTs to for a given webhook path.
 *
 * A leaf module on purpose: provider subscription handlers and client views both need it, and
 * `@/triggers/webhook-url` pulls in the block and trigger registries.
 */
export function buildWebhookTriggerUrl(path: string): string {
  return `${getBaseUrl()}/api/webhooks/trigger/${path}`
}
