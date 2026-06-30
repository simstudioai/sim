import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Sentry')

/**
 * Sentry signs webhooks with the Internal Integration's Client Secret using
 * HMAC-SHA256 over the raw request body, delivered in the
 * `sentry-hook-signature` header as a hex digest.
 *
 * @see https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
 */
function validateSentrySignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      return false
    }
    const computedHash = hmacSha256Hex(body, secret)
    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Sentry signature:', error)
    return false
  }
}

/** Header carrying the resource type that triggered the webhook. */
const SENTRY_RESOURCE_HEADER = 'sentry-hook-resource'

/**
 * Exposes the payload's `type` field as `eventType`. `TriggerOutput` reserves
 * the `type` key, so nested `type` fields are surfaced under an alias for the
 * tag dropdown (the original `type` is preserved on the passthrough object).
 */
function aliasEventType(entity: unknown): Record<string, unknown> | null {
  if (!entity || typeof entity !== 'object') return null
  const obj = entity as Record<string, unknown>
  return { ...obj, eventType: obj.type ?? null }
}

export const sentryHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'clientSecret',
    headerName: 'Sentry-Hook-Signature',
    validateFn: validateSentrySignature,
    providerLabel: 'Sentry',
    requireSecret: true,
  }),

  async matchEvent({ body, request, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (triggerId) {
      const resource = request.headers.get(SENTRY_RESOURCE_HEADER)
      const obj = body as Record<string, unknown>
      const action = obj.action as string | undefined

      const { isSentryEventMatch } = await import('@/triggers/sentry/utils')
      if (!isSentryEventMatch(triggerId, resource, action)) {
        logger.debug(
          `[${requestId}] Sentry event mismatch for trigger ${triggerId}. Resource: ${resource}, Action: ${action}. Skipping.`
        )
        return false
      }
    }
    return true
  },

  async formatInput({ body, headers }: FormatInputContext): Promise<FormatInputResult> {
    const b = (body as Record<string, unknown>) || {}
    const data = (b.data as Record<string, unknown>) || {}
    const resource = headers[SENTRY_RESOURCE_HEADER] || ''

    const envelope = {
      action: (b.action as string) || '',
      installation: b.installation ?? null,
      actor: b.actor ?? null,
    }

    switch (resource) {
      case 'issue':
        return { input: { ...envelope, issue: aliasEventType(data.issue) } }
      case 'error':
        return { input: { ...envelope, error: aliasEventType(data.error) } }
      case 'event_alert':
        return {
          input: {
            ...envelope,
            event: data.event ?? null,
            triggered_rule: (data.triggered_rule as string) ?? '',
            issue_alert: data.issue_alert ?? null,
          },
        }
      case 'metric_alert':
        return {
          input: {
            ...envelope,
            metric_alert: data.metric_alert ?? null,
            description_text: (data.description_text as string) ?? '',
            description_title: (data.description_title as string) ?? '',
            web_url: (data.web_url as string) ?? '',
          },
        }
      default:
        return { input: { ...envelope, data } }
    }
  },

  extractIdempotencyId(body: unknown): string | null {
    const obj = body as Record<string, unknown>
    const data = (obj?.data as Record<string, unknown>) || {}
    const action = typeof obj?.action === 'string' ? obj.action : ''

    const issue = data.issue as Record<string, unknown> | undefined
    if (issue?.id) {
      return `sentry:issue:${issue.id}:${action}`
    }

    const error = data.error as Record<string, unknown> | undefined
    if (error?.event_id) {
      return `sentry:error:${error.event_id}`
    }

    const event = data.event as Record<string, unknown> | undefined
    if (event?.event_id) {
      return `sentry:event_alert:${event.event_id}`
    }

    const metricAlert = data.metric_alert as Record<string, unknown> | undefined
    if (metricAlert?.id) {
      return `sentry:metric_alert:${metricAlert.id}:${action}`
    }

    return null
  },
}
