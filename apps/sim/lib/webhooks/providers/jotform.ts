import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  DeleteSubscriptionContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { normalizeWebhooks } from '@/tools/jotform/normalize'
import {
  buildJotformHeaders,
  buildJotformUrl,
  jotformFormHeaders,
  parseJotformResponse,
  toFormBody,
  toStringOrNull,
} from '@/tools/jotform/utils'

const logger = createLogger('WebhookProvider:Jotform')

interface JotformSubscriptionCredentials {
  formId: string
  apiKey: string
  region?: string
}

function readCredentials(
  webhook: Record<string, unknown>
): JotformSubscriptionCredentials | { error: string } {
  const config = getProviderConfig(webhook)
  const formId = toStringOrNull(config.formId)?.trim()
  const apiKey = toStringOrNull(config.apiKey)?.trim()

  if (!formId) return { error: 'Form ID is required to register a Jotform webhook.' }
  if (!apiKey) {
    return {
      error:
        'API Key is required to register a Jotform webhook. Create one under Account Settings > API with Full Access.',
    }
  }

  return { formId, apiKey, region: toStringOrNull(config.apiRegion)?.trim() || undefined }
}

/** Compares callback URLs without letting a trailing slash decide the outcome. */
function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
}

/**
 * Jotform identifies a form's webhooks by their position in the form's webhook map, and
 * adding one renumbers the rest — the documented POST sample returns the new entry as
 * `"0"`. An id captured at registration is therefore stale as soon as the form's webhooks
 * change at all. Nothing persists it; every path re-resolves it by matching the URL.
 */
function findWebhookIdByUrl(content: unknown, notificationUrl: string): string | null {
  return normalizeWebhooks(content).find((entry) => sameUrl(entry.url, notificationUrl))?.id ?? null
}

async function listWebhookIdForUrl(
  credentials: JotformSubscriptionCredentials,
  notificationUrl: string
): Promise<string | null> {
  const response = await fetch(
    buildJotformUrl(
      credentials,
      `form/${encodeURIComponent(credentials.formId)}/webhooks`
    ).toString(),
    { method: 'GET', headers: buildJotformHeaders(credentials.apiKey) }
  )
  const envelope = await parseJotformResponse(response, 'Jotform List Webhooks')
  return findWebhookIdByUrl(envelope.content, notificationUrl)
}

export const jotformHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const payload = isRecordLike(body) ? body : {}

    /* Jotform posts `rawRequest` as a JSON string inside a multipart body. A form whose
       answers fail to parse is still worth executing on, so a bad string degrades to null
       rather than dropping the submission. */
    let rawRequest: unknown = null
    const rawRequestString = toStringOrNull(payload.rawRequest)
    if (rawRequestString) {
      try {
        rawRequest = JSON.parse(rawRequestString)
      } catch (error) {
        logger.warn('Jotform rawRequest was not valid JSON', { error: getErrorMessage(error) })
      }
    }

    return {
      input: {
        formId: toStringOrNull(payload.formID) ?? '',
        submissionId: toStringOrNull(payload.submissionID) ?? '',
        formTitle: toStringOrNull(payload.formTitle) ?? '',
        username: toStringOrNull(payload.username) ?? '',
        ip: toStringOrNull(payload.ip) ?? '',
        submissionType: toStringOrNull(payload.type) ?? '',
        pretty: toStringOrNull(payload.pretty) ?? '',
        rawRequest,
        raw: payload,
      },
    }
  },

  extractIdempotencyId(body: unknown): string | null {
    if (!isRecordLike(body)) return null
    const submissionId = toStringOrNull(body.submissionID)
    return submissionId ? `submission:${submissionId}` : null
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const credentials = readCredentials(ctx.webhook)
    if ('error' in credentials) {
      logger.warn(`[${ctx.requestId}] ${credentials.error}`, { webhookId: ctx.webhook.id })
      throw new Error(credentials.error)
    }

    const notificationUrl = getNotificationUrl(ctx.webhook)

    try {
      /* Jotform keeps a plain list and does not treat the URL as a key, so posting one it
         already holds is not a no-op — it would leave the form delivering every submission
         twice. Redeploys re-run this, so the existing list decides whether to post. */
      if (await listWebhookIdForUrl(credentials, notificationUrl)) {
        logger.info(`[${ctx.requestId}] Jotform webhook was already registered`, {
          webhookId: ctx.webhook.id,
          formId: credentials.formId,
        })
        return {}
      }

      const response = await fetch(
        buildJotformUrl(
          credentials,
          `form/${encodeURIComponent(credentials.formId)}/webhooks`
        ).toString(),
        {
          method: 'POST',
          headers: jotformFormHeaders(credentials.apiKey),
          body: toFormBody({ webhookURL: notificationUrl }),
        }
      )

      /* Jotform answers a rejected registration with the unchanged webhook list rather
         than an error, so the response is only a success if our URL is in it. */
      const envelope = await parseJotformResponse(response, 'Jotform Create Webhook')
      if (!findWebhookIdByUrl(envelope.content, notificationUrl)) {
        throw new Error(
          'Jotform accepted the request but did not register the webhook URL on the form. Verify the form ID and that the API key has Full Access.'
        )
      }

      logger.info(`[${ctx.requestId}] Registered Jotform webhook`, {
        webhookId: ctx.webhook.id,
        formId: credentials.formId,
      })

      return {}
    } catch (error) {
      logger.error(`[${ctx.requestId}] Failed to register Jotform webhook`, {
        webhookId: ctx.webhook.id,
        error: getErrorMessage(error),
      })
      throw new Error(getErrorMessage(error, 'Failed to register the Jotform webhook.'))
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const credentials = readCredentials(ctx.webhook)
    if ('error' in credentials) {
      logger.warn(
        `[${ctx.requestId}] Missing Jotform credentials, skipping webhook cleanup for ${ctx.webhook.id}`
      )
      if (ctx.strict) throw new Error(credentials.error)
      return
    }

    const notificationUrl = getNotificationUrl(ctx.webhook)

    try {
      const webhookId = await listWebhookIdForUrl(credentials, notificationUrl)

      if (!webhookId) {
        logger.info(
          `[${ctx.requestId}] Jotform webhook was already absent from form ${credentials.formId}`
        )
        return
      }

      const response = await fetch(
        buildJotformUrl(
          credentials,
          `form/${encodeURIComponent(credentials.formId)}/webhooks/${encodeURIComponent(webhookId)}`
        ).toString(),
        { method: 'DELETE', headers: buildJotformHeaders(credentials.apiKey) }
      )

      await parseJotformResponse(response, 'Jotform Delete Webhook')
      logger.info(`[${ctx.requestId}] Deleted Jotform webhook from form ${credentials.formId}`)
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Error deleting Jotform webhook (non-fatal)`, {
        error: getErrorMessage(error),
      })
      if (ctx.strict) throw error
    }
  },
}
