import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { toRecordOrNull } from '@sim/utils/object'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { verifyStandardWebhookRequest } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Incidentio')

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
  const wrapper = eventType ? toRecordOrNull(body[eventType]) : null
  if (!wrapper) return null
  return toRecordOrNull(wrapper[key]) ?? wrapper
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

    const failure = verifyStandardWebhookRequest({
      request,
      rawBody,
      requestId,
      secret: signingSecret,
      providerLabel: 'incident.io',
    })
    if (failure) return failure

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
    const b = (toRecordOrNull(body) ?? {}) as Record<string, unknown>
    const eventType = typeof b.event_type === 'string' ? b.event_type : ''
    const wrapper = eventType ? toRecordOrNull(b[eventType]) : null
    const isAlert = eventType.startsWith('public_alert.')

    if (isAlert) {
      const alert = extractEntity(b, eventType, 'alert')
      return {
        input: {
          event_type: eventType,
          alert,
          alert_id: toStringOrNull(alert?.id),
          title: toStringOrNull(alert?.title),
          description: toStringOrNull(alert?.description),
          status: toStringOrNull(alert?.status),
          alert_source_id: toStringOrNull(alert?.alert_source_id),
          deduplication_key: toStringOrNull(alert?.deduplication_key),
          source_url: toStringOrNull(alert?.source_url),
          created_at: toStringOrNull(alert?.created_at),
          updated_at: toStringOrNull(alert?.updated_at),
          resolved_at: toStringOrNull(alert?.resolved_at),
          payload: b,
        },
      }
    }

    const incident = extractEntity(b, eventType, 'incident')
    return {
      input: {
        event_type: eventType,
        incident,
        incident_id: toStringOrNull(incident?.id),
        name: toStringOrNull(incident?.name),
        reference: toStringOrNull(incident?.reference),
        summary: toStringOrNull(incident?.summary),
        incident_status: toRecordOrNull(incident?.incident_status),
        severity: toRecordOrNull(incident?.severity),
        mode: toStringOrNull(incident?.mode),
        visibility: toStringOrNull(incident?.visibility),
        permalink: toStringOrNull(incident?.permalink),
        created_at: toStringOrNull(incident?.created_at),
        updated_at: toStringOrNull(incident?.updated_at),
        new_status: toRecordOrNull(wrapper?.new_status),
        previous_status: toRecordOrNull(wrapper?.previous_status),
        update_message: toStringOrNull(wrapper?.message),
        payload: b,
      },
    }
  },

  extractIdempotencyId(body: unknown) {
    const b = toRecordOrNull(body)
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
