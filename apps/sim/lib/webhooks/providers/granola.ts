import { createLogger } from '@sim/logger'
import { toRecordOrNull } from '@sim/utils/object'
import { NextResponse } from 'next/server'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  AuthContext,
  DeleteSubscriptionContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { verifyStandardWebhookRequest } from '@/lib/webhooks/providers/utils'
import { GRANOLA_TRIGGER_TO_EVENT_TYPES } from '@/triggers/granola/utils'

const logger = createLogger('WebhookProvider:Granola')

const GRANOLA_WEBHOOK_ENDPOINTS_URL = 'https://public-api.granola.ai/v1/webhook-endpoints'

/** Scopes used when the trigger leaves the field blank. */
const DEFAULT_GRANOLA_SCOPES = ['personal', 'public']

/**
 * Parse a comma-separated or JSON-array trigger field into a string list.
 * Trigger fields are free text, so both forms are accepted.
 */
function parseList(value: unknown): string[] {
  const split = (entry: unknown) =>
    String(entry)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)

  /* Trigger config can arrive array-wrapped rather than split, so an entry may still
     hold a comma-separated list; split inside entries as well as across them. */
  if (Array.isArray(value)) return value.flatMap(split)
  if (typeof value !== 'string') return []

  const trimmed = value.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.flatMap(split)
      }
    } catch {
      /* Fall through to comma-separated parsing. */
    }
  }

  return split(trimmed)
}

/** Turn a Granola API failure into a message worth showing on the deploy dialog. */
function granolaUserFacingError(status: number, body: string): string {
  if (status === 401) {
    return 'Invalid Granola API Key. Please verify the key in the trigger configuration.'
  }
  if (status === 403) {
    return 'Granola denied a requested scope. Workspace admins control which scopes members can use in Settings > Workspace > General > API access for members.'
  }
  if (status === 404) {
    return 'The Granola webhooks API is not available for this workspace. Webhooks require a Granola Business or Enterprise plan.'
  }
  return `Failed to create Granola webhook endpoint (${status})${body ? `: ${body}` : ''}`
}

/** Delete one Granola webhook endpoint. Treats an already-deleted endpoint as success. */
async function deleteGranolaEndpoint(apiKey: string, endpointId: string): Promise<void> {
  const response = await fetch(
    `${GRANOLA_WEBHOOK_ENDPOINTS_URL}/${encodeURIComponent(endpointId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Failed to delete Granola webhook endpoint ${endpointId}: ${response.status}`)
  }
}

/**
 * Remove an endpoint Granola created for a registration that then failed.
 *
 * The registration service only rolls external state back when
 * `createSubscription` *returns*; a handler that throws is assumed to have left
 * nothing behind (`prepareStableWebhookCandidate` guards its rollback on
 * `preparedProviderConfig`). So anything already created here has to be undone
 * here, or the endpoint stays live with no external id recorded and keeps
 * delivering to a callback whose signature can never be verified.
 *
 * Deliberately keyed on the id Granola returned, and nothing else. A redeploy
 * reuses the live registration's `path`, so the candidate and the currently
 * serving endpoint share a callback URL — recovering "our" endpoint by matching
 * that URL would delete the live deployment's endpoint and silently kill a
 * working trigger. When Granola's response carries no id there is no way to
 * tell the two apart, so the endpoint is left in place: a leaked endpoint
 * produces unverifiable deliveries that Granola eventually disables, which is
 * far less harmful than taking down live traffic.
 *
 * Best effort by design: it never throws, because the caller is already
 * throwing the failure that matters.
 */
async function cleanupOrphanedGranolaEndpoint(params: {
  apiKey: string
  endpointId: string
  requestId: string
}): Promise<void> {
  const { apiKey, endpointId, requestId } = params
  try {
    await deleteGranolaEndpoint(apiKey, endpointId)
    logger.info(`[${requestId}] Removed orphaned Granola webhook endpoint ${endpointId}`)
  } catch (error) {
    logger.error(
      `[${requestId}] Failed to remove orphaned Granola webhook endpoint ${endpointId}; it may still be active`,
      error
    )
  }
}

export const granolaHandler: WebhookProviderHandler = {
  /**
   * Granola endpoints are registered by Sim, so the signing secret is always
   * stored on the webhook row. A missing secret means the row is broken rather
   * than unsecured, so verification fails closed.
   */
  async verifyAuth({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> {
    const signingSecret = providerConfig.signingSecret as string | undefined
    if (!signingSecret?.trim()) {
      logger.warn(`[${requestId}] Granola webhook missing signing secret in provider configuration`)
      return new NextResponse('Unauthorized - Granola signing secret is required', { status: 401 })
    }

    const failure = verifyStandardWebhookRequest({
      request,
      rawBody,
      requestId,
      secret: signingSecret,
      providerLabel: 'Granola',
    })
    if (failure) return failure

    return null
  },

  async matchEvent({ body, providerConfig, requestId }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId) return true

    const { isGranolaEventMatch } = await import('@/triggers/granola/utils')
    const eventType = (toRecordOrNull(body)?.event_type as string | undefined) ?? ''

    if (!isGranolaEventMatch(triggerId, eventType)) {
      logger.debug(
        `[${requestId}] Granola event mismatch for trigger ${triggerId}. event_type: ${eventType}. Skipping.`
      )
      return false
    }
    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = toRecordOrNull(body) ?? {}
    const data = toRecordOrNull(b.data)

    return {
      input: {
        event_id: typeof b.event_id === 'string' ? b.event_id : null,
        event_type: typeof b.event_type === 'string' ? b.event_type : null,
        note_id: typeof b.note_id === 'string' ? b.note_id : null,
        occurred_at: typeof b.occurred_at === 'string' ? b.occurred_at : null,
        changed_fields: Array.isArray(data?.changed_fields) ? data.changed_fields : null,
        payload: b,
      },
    }
  },

  /**
   * Granola reuses `event_id` across retries of the same delivery, which makes
   * it the natural idempotency key.
   */
  extractIdempotencyId(body: unknown) {
    const b = toRecordOrNull(body)
    return typeof b?.event_id === 'string' && b.event_id ? b.event_id : null
  },

  /**
   * Registers a Granola webhook endpoint pointing at this webhook's callback
   * URL. The endpoint subscribes only to the trigger's own event names, so a
   * workflow is never woken by an event it did not ask for.
   *
   * The signing secret is returned once, here, and is stored on the webhook row
   * because `verifyAuth` needs it on every delivery — it cannot be re-fetched.
   */
  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    const providerConfig = getProviderConfig(webhook)
    const apiKey = providerConfig.apiKey as string | undefined
    const triggerId = providerConfig.triggerId as string | undefined

    if (!apiKey) {
      logger.warn(`[${requestId}] Missing apiKey for Granola webhook creation.`, {
        webhookId: webhook.id,
      })
      throw new Error(
        'Granola API Key is required. Please provide your Granola API key in the trigger configuration.'
      )
    }

    const scopes = parseList(providerConfig.scopes)
    const folderIds = parseList(providerConfig.folderIds)
    const events = [...(GRANOLA_TRIGGER_TO_EVENT_TYPES[triggerId ?? ''] ?? [])]

    const requestBody: Record<string, unknown> = {
      url: getNotificationUrl(webhook),
      scopes: scopes.length > 0 ? scopes : DEFAULT_GRANOLA_SCOPES,
    }
    if (events.length > 0) requestBody.events = events
    if (folderIds.length > 0) requestBody.folder_ids = folderIds

    logger.info(`[${requestId}] Creating Granola webhook endpoint`, {
      triggerId,
      events,
      scopes: requestBody.scopes,
      folderCount: folderIds.length,
      webhookId: webhook.id,
    })

    const response = await fetch(GRANOLA_WEBHOOK_ENDPOINTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    /* Granola rejected the request outright, so no endpoint exists to clean up. */
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      logger.error(
        `[${requestId}] Failed to create Granola webhook endpoint for webhook ${webhook.id}. Status: ${response.status}`,
        { response: errorBody }
      )
      throw new Error(granolaUserFacingError(response.status, errorBody))
    }

    const created = (await response.json().catch(() => ({}))) as {
      id?: string
      signing_secret?: string
    }

    if (!created.id || !created.signing_secret) {
      logger.error(
        `[${requestId}] Granola webhook endpoint response missing id or signing secret for webhook ${webhook.id}.`
      )
      if (created.id) {
        await cleanupOrphanedGranolaEndpoint({ apiKey, endpointId: created.id, requestId })
      }
      throw new Error(
        'Granola created the webhook endpoint but did not return an ID and signing secret, so deliveries could not be verified.'
      )
    }

    logger.info(
      `[${requestId}] Successfully created Granola webhook endpoint for webhook ${webhook.id}.`,
      { externalId: created.id }
    )

    return {
      providerConfigUpdates: {
        externalId: created.id,
        signingSecret: created.signing_secret,
        eventTypes: events,
      },
    }
  },

  /**
   * Deletes the Granola endpoint this webhook row created. Each Sim webhook row
   * owns exactly one Granola endpoint keyed by its own callback path, so this
   * never removes an endpoint another workflow is still using.
   */
  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const { webhook, requestId } = ctx
    try {
      const config = getProviderConfig(webhook)
      const apiKey = config.apiKey as string | undefined
      const externalId = config.externalId as string | undefined

      if (!apiKey || !externalId) {
        logger.warn(
          `[${requestId}] Missing ${!apiKey ? 'apiKey' : 'externalId'} for Granola webhook deletion ${webhook.id}, skipping cleanup`
        )
        if (ctx.strict) {
          throw new Error(
            `Missing Granola ${!apiKey ? 'apiKey' : 'externalId'} for webhook deletion`
          )
        }
        return
      }

      await deleteGranolaEndpoint(apiKey, externalId)

      logger.info(`[${requestId}] Successfully deleted Granola webhook endpoint ${externalId}`)
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Granola webhook endpoint (non-fatal)`, error)
      if (ctx.strict) throw error
    }
  },
}
