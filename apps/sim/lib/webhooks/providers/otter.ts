import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { toRecordOrNull } from '@sim/utils/object'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import {
  mapOtterChannel,
  mapOtterConversationDetail,
  mapOtterUser,
  normalizeOtterEvent,
  readOtterId,
} from '@/tools/otter/utils'

const logger = createLogger('WebhookProvider:Otter')

/**
 * Read the `meta.webhook` block Otter attaches to every delivery.
 * @see https://help.otter.ai/hc/en-us/articles/35634832371735-Workspace-Webhooks
 */
function readWebhookMeta(body: unknown) {
  const meta = toRecordOrNull(toRecordOrNull(body)?.meta)
  const webhook = toRecordOrNull(meta?.webhook)
  return {
    retrievedAt: toStringOrNull(meta?.retrieved_at),
    event: typeof webhook?.event === 'string' ? normalizeOtterEvent(webhook.event) || null : null,
    name: toStringOrNull(webhook?.name),
    sourceType: toStringOrNull(webhook?.source_type),
    source: webhook?.source ?? null,
    createdBy: webhook?.created_by,
  }
}

/**
 * Otter workspace webhooks are created by hand in Otter's admin UI and carry no
 * signature or configurable auth header, so the unguessable callback path is
 * the only credential — the same model as the default handler without a token.
 */
export const otterHandler: WebhookProviderHandler = {
  async matchEvent({ body, providerConfig, requestId }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId) return true

    const { isOtterEventMatch } = await import('@/triggers/otter/utils')
    const { event } = readWebhookMeta(body)
    if (!isOtterEventMatch(triggerId, event)) {
      logger.debug(`[${requestId}] Otter event mismatch for trigger ${triggerId}: ${event}`)
      return false
    }
    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const meta = readWebhookMeta(body)
    const conversation = mapOtterConversationDetail(toRecordOrNull(body)?.data, body)

    return {
      input: {
        event: meta.event,
        webhookName: meta.name,
        sourceType: meta.sourceType,
        // Only the channel source shape is documented; other sources pass through as delivered.
        source: meta.sourceType === 'channel' ? mapOtterChannel(meta.source) : meta.source,
        createdBy: mapOtterUser(meta.createdBy),
        retrievedAt: meta.retrievedAt,
        ...conversation,
        payload: body,
      },
    }
  },

  /**
   * Otter sends no delivery ID. A conversation completes once per source, so
   * `conversation_completed` is keyed by event, source, and conversation, and
   * Otter's two retry attempts collapse onto the first delivery. A conversation
   * can be shared to the same source again later, so `conversation_shared` also
   * keys on `meta.retrieved_at`, the time Otter assembled that delivery, keeping
   * each share a separate run.
   */
  extractIdempotencyId(body: unknown) {
    const conversationId = readOtterId(toRecordOrNull(toRecordOrNull(body)?.data)?.id)
    if (!conversationId) return null
    const { event, sourceType, source, retrievedAt } = readWebhookMeta(body)
    const sourceId = readOtterId(toRecordOrNull(source)?.id)
    const occurrence = event === 'conversation_shared' ? `:${retrievedAt ?? ''}` : ''
    return `otter:${event ?? ''}:${sourceType ?? ''}:${sourceId}:${conversationId}${occurrence}`
  },
}
