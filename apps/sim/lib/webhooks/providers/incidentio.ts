import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Base64 } from '@sim/security/hmac'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Incidentio')

const INCIDENTIO_WEBHOOK_TIMESTAMP_SKEW_SECONDS = 5 * 60

/**
 * Verify an incident.io webhook signature using the Svix signing scheme.
 * incident.io webhooks are powered by Svix: HMAC-SHA256 of
 * `${webhook-id}.${webhook-timestamp}.${body}` signed with the base64-decoded
 * `whsec_...` secret, compared against the `webhook-signature` header which may
 * carry one or more space-separated `v1,<base64sig>` entries.
 * @see https://docs.incident.io/integrations/webhooks
 */
function verifyIncidentioSignature(
  secret: string,
  msgId: string,
  timestamp: string,
  signatures: string,
  rawBody: string
): boolean {
  try {
    const ts = Number.parseInt(timestamp, 10)
    const now = Math.floor(Date.now() / 1000)
    if (Number.isNaN(ts) || Math.abs(now - ts) > INCIDENTIO_WEBHOOK_TIMESTAMP_SKEW_SECONDS) {
      return false
    }

    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const toSign = `${msgId}.${timestamp}.${rawBody}`
    const expectedSignature = hmacSha256Base64(toSign, secretBytes)

    const providedSignatures = signatures.split(' ')
    for (const versionedSig of providedSignatures) {
      const parts = versionedSig.split(',')
      if (parts.length !== 2) continue
      const sig = parts[1]
      if (safeCompare(sig, expectedSignature)) {
        return true
      }
    }
    return false
  } catch (error) {
    logger.error('Error verifying incident.io Svix signature:', error)
    return false
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Locate a named entity (incident/alert) within an incident.io webhook body.
 *
 * Verified against the incident.io webhooks OpenAPI spec
 * (https://docs.incident.io/openapi/webhooks.json). The body is a Svix
 * envelope `{ event_type, [event_type]: <wrapper> }` where:
 *   - `incident_created_v2` / `incident_updated_v2` / `alert_created_v1`: the
 *     wrapper IS the entity (incident/alert fields directly under the key).
 *   - `incident_status_updated_v2`: the wrapper nests the incident under
 *     `.incident` alongside `new_status` / `previous_status` / `message`.
 * Returns null when the entity cannot be found.
 */
function extractEntity(
  body: Record<string, unknown>,
  eventType: string,
  key: 'incident' | 'alert'
): Record<string, unknown> | null {
  const wrapper = eventType ? asObject(body[eventType]) : null
  if (!wrapper) return null
  return asObject(wrapper[key]) ?? wrapper
}

export const incidentioHandler: WebhookProviderHandler = {
  async verifyAuth({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> {
    const signingSecret = providerConfig.signingSecret as string | undefined
    if (!signingSecret?.trim()) {
      logger.warn(
        `[${requestId}] incident.io webhook missing signing secret in provider configuration`
      )
      return new NextResponse('Unauthorized - incident.io signing secret is required', {
        status: 401,
      })
    }

    const webhookId = request.headers.get('webhook-id')
    const webhookTimestamp = request.headers.get('webhook-timestamp')
    const webhookSignature = request.headers.get('webhook-signature')

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      logger.warn(`[${requestId}] incident.io webhook missing Svix signature headers`)
      return new NextResponse('Unauthorized - Missing incident.io signature headers', {
        status: 401,
      })
    }

    if (
      !verifyIncidentioSignature(
        signingSecret,
        webhookId,
        webhookTimestamp,
        webhookSignature,
        rawBody
      )
    ) {
      logger.warn(`[${requestId}] incident.io Svix signature verification failed`)
      return new NextResponse('Unauthorized - Invalid incident.io signature', { status: 401 })
    }

    return null
  },

  async matchEvent({ body, providerConfig, requestId }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId) {
      return true
    }

    const { isIncidentioEventMatch } = await import('@/triggers/incidentio/utils')
    const eventType = (body as Record<string, unknown>)?.event_type as string | undefined

    if (!isIncidentioEventMatch(triggerId, eventType || '')) {
      logger.debug(
        `[${requestId}] incident.io event mismatch for trigger ${triggerId}. event_type: ${eventType}. Skipping.`
      )
      return false
    }
    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = (asObject(body) ?? {}) as Record<string, unknown>
    const eventType = typeof b.event_type === 'string' ? b.event_type : ''
    const wrapper = eventType ? asObject(b[eventType]) : null
    const isAlert = eventType.startsWith('public_alert.')

    if (isAlert) {
      const alert = extractEntity(b, eventType, 'alert')
      return {
        input: {
          event_type: eventType,
          alert,
          alert_id: asString(alert?.id),
          title: asString(alert?.title),
          description: asString(alert?.description),
          status: asString(alert?.status),
          alert_source_id: asString(alert?.alert_source_id),
          deduplication_key: asString(alert?.deduplication_key),
          source_url: asString(alert?.source_url),
          created_at: asString(alert?.created_at),
          updated_at: asString(alert?.updated_at),
          resolved_at: asString(alert?.resolved_at),
          payload: b,
        },
      }
    }

    const incident = extractEntity(b, eventType, 'incident')
    return {
      input: {
        event_type: eventType,
        incident,
        incident_id: asString(incident?.id),
        name: asString(incident?.name),
        reference: asString(incident?.reference),
        summary: asString(incident?.summary),
        incident_status: asObject(incident?.incident_status),
        severity: asObject(incident?.severity),
        mode: asString(incident?.mode),
        visibility: asString(incident?.visibility),
        permalink: asString(incident?.permalink),
        created_at: asString(incident?.created_at),
        updated_at: asString(incident?.updated_at),
        new_status: asObject(wrapper?.new_status),
        previous_status: asObject(wrapper?.previous_status),
        update_message: asString(wrapper?.message),
        payload: b,
      },
    }
  },

  extractIdempotencyId(body: unknown) {
    const b = asObject(body)
    if (!b) return null
    const eventType = typeof b.event_type === 'string' ? b.event_type : ''
    const key = eventType.startsWith('public_alert.') ? 'alert' : 'incident'
    const entity = extractEntity(b, eventType, key as 'incident' | 'alert')
    const entityId = entity && typeof entity.id === 'string' ? entity.id : null
    if (eventType && entityId) {
      return `${eventType}:${entityId}`
    }
    return null
  },
}
