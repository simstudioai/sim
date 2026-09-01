import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { generateId } from '@sim/utils/id'
import { isRecordLike, omit } from '@sim/utils/object'
import { NextResponse } from 'next/server'
import { isPayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
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
import { buildFallbackDeliveryFingerprint } from '@/lib/webhooks/providers/utils'

/**
 * Kept local rather than imported from `@/tools/ashby/utils`, which has the same
 * logic. The webhook providers are reachable from workspace page graphs, and the
 * knowledge page graph currently sits exactly at the ceiling
 * `check:tool-registry-boundary` allows - so neither an import edge into
 * `@/tools/**` nor an extra module in this directory fits. Both copies derive
 * from the same three documented Ashby error shapes and are covered
 * independently by `tools/ashby/utils.test.ts` and `ashby.test.ts` here.
 */
/**
 * Extract a human-readable error message from an Ashby error response. Ashby
 * documents two shapes and uses three in practice:
 *
 * - `errorInfo: { code, message, requestId }`
 * - `errors: ['webhook_not_found']` - plain strings
 * - `errors: [{ message, parameter }]` - objects, which is the form a 403 for a
 *   missing module permission arrives in, and which stringifies to
 *   `[object Object]` unless the message is read explicitly
 *
 * A single response can carry more than one of these at once.
 */
function ashbyErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const d = data as Record<string, unknown>
  const info = d.errorInfo as Record<string, unknown> | undefined
  if (info && typeof info.message === 'string' && info.message) return info.message
  if (Array.isArray(d.errors) && d.errors.length > 0) {
    const messages = d.errors
      .map((e) => {
        if (typeof e === 'string') return e
        if (e && typeof e === 'object') {
          const entry = e as Record<string, unknown>
          const message = typeof entry.message === 'string' ? entry.message : ''
          const parameter = typeof entry.parameter === 'string' ? entry.parameter : ''
          if (message && parameter) return `${message} (${parameter})`
          if (message) return message
        }
        return ''
      })
      .filter(Boolean)
    if (messages.length > 0) return messages.join('; ')
  }
  return fallback
}

/**
 * Whether an Ashby error response means the webhook id no longer exists.
 *
 * Ashby signals this as the machine code `webhook_not_found`, carried on
 * `errorInfo.code` and/or as an `errors` entry — but the same envelope's
 * `errorInfo.message` reads `Webhook not found`, and that is what
 * `ashbyErrorMessage` returns, since message wins over the deprecated code
 * array. Matching the extracted message against the code therefore misses the
 * envelope Ashby actually sends for a repeat delete, and idempotent cleanup
 * would be reported as a real failure. Read the codes directly, and keep a
 * prose fallback for the message-only form.
 */
function isAshbyWebhookNotFound(data: Record<string, unknown>, message: string): boolean {
  const info = data.errorInfo as Record<string, unknown> | undefined
  if (typeof info?.code === 'string' && /webhook_not_found/i.test(info.code)) return true

  if (Array.isArray(data.errors)) {
    for (const entry of data.errors) {
      if (typeof entry === 'string' && /webhook_not_found/i.test(entry)) return true
      if (entry && typeof entry === 'object') {
        const entryMessage = (entry as Record<string, unknown>).message
        if (typeof entryMessage === 'string' && /webhook_not_found/i.test(entryMessage)) return true
      }
    }
  }

  return /webhook[\s_]not[\s_]found/i.test(message)
}

const logger = createLogger('WebhookProvider:Ashby')
const MAX_ASHBY_WEBHOOK_RESPONSE_BYTES = 2 * 1024 * 1024

async function readAshbyManagementResponse(
  response: Response,
  label: string
): Promise<Record<string, unknown>> {
  try {
    const body = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_ASHBY_WEBHOOK_RESPONSE_BYTES,
      label,
    })
    return isRecordLike(body) ? body : {}
  } catch (error) {
    if (isPayloadSizeLimitError(error)) throw error
    return {}
  }
}

function validateAshbySignature(secretToken: string, signature: string, body: string): boolean {
  try {
    if (!secretToken || !signature || !body) {
      return false
    }
    if (!signature.startsWith('sha256=')) {
      return false
    }
    const providedSignature = signature.substring(7)
    const computedHash = hmacSha256Hex(body, secretToken)
    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Ashby signature:', error)
    return false
  }
}

export const ashbyHandler: WebhookProviderHandler = {
  extractIdempotencyId(body: unknown): string | null {
    if (!isRecordLike(body)) return null
    const action = typeof body.action === 'string' ? body.action : undefined
    if (!action) return null

    if (typeof body.webhookActionId === 'string' && body.webhookActionId) {
      return `ashby:webhook-action:${body.webhookActionId}`
    }

    const data = isRecordLike(body.data) ? body.data : undefined
    if (!data) return null

    const application = data.application as Record<string, unknown> | undefined
    const candidate = data.candidate as Record<string, unknown> | undefined
    const job = data.job as Record<string, unknown> | undefined
    const offer = data.offer as Record<string, unknown> | undefined
    const interviewSchedule = data.interviewSchedule as Record<string, unknown> | undefined
    const jobPosting = data.jobPosting as Record<string, unknown> | undefined
    const opening = data.opening as Record<string, unknown> | undefined
    const mergedCandidate = data.mergedCandidate as Record<string, unknown> | undefined

    if (application?.id) {
      const discriminator = application.updatedAt ?? buildFallbackDeliveryFingerprint(data)
      const offerSuffix = offer?.id ? `:${offer.id}` : ''
      return `ashby:${action}:${application.id}:${discriminator}${offerSuffix}`
    }
    if (offer?.id) {
      return `ashby:${action}:${offer.id}`
    }
    if (candidate?.id) {
      return `ashby:${action}:${candidate.id}`
    }
    if (job?.id) {
      return `ashby:${action}:${job.id}`
    }
    if (interviewSchedule?.id)
      return `ashby:${action}:${interviewSchedule.id}:${interviewSchedule.updatedAt ?? buildFallbackDeliveryFingerprint(data)}`
    if (jobPosting?.id)
      return `ashby:${action}:${jobPosting.id}:${jobPosting.updatedAt ?? buildFallbackDeliveryFingerprint(data)}`
    if (opening?.id) return `ashby:${action}:${opening.id}`
    if (mergedCandidate?.id) return `ashby:${action}:${mergedCandidate.id}`
    if (typeof data.applicationId === 'string')
      return `ashby:${action}:${data.applicationId}:${data.eventType ?? buildFallbackDeliveryFingerprint(data)}`
    if (typeof data.offerId === 'string')
      return `ashby:${action}:${data.offerId}:${data.eventType ?? buildFallbackDeliveryFingerprint(data)}`
    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const data = (b.data as Record<string, unknown>) || {}
    const application = data.application as Record<string, unknown> | undefined
    const currentInterviewStage = application?.currentInterviewStage as
      | Record<string, unknown>
      | undefined

    return {
      input: {
        ...data,
        ...(application && currentInterviewStage
          ? {
              application: {
                ...application,
                currentInterviewStage: {
                  ...omit(currentInterviewStage, ['type']),
                  stageType: currentInterviewStage.type,
                },
              },
            }
          : {}),
        action: b.action,
        ...(typeof b.webhookActionId === 'string' ? { webhookActionId: b.webhookActionId } : {}),
      },
    }
  },

  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext): NextResponse | null {
    const secretToken = (providerConfig.secretToken as string | undefined)?.trim()
    if (!secretToken) {
      logger.warn(
        `[${requestId}] Ashby webhook missing secretToken in providerConfig — rejecting request`
      )
      return new NextResponse(
        'Unauthorized - Ashby webhook signing secret is not configured. Re-save the trigger so a webhook can be registered.',
        { status: 401 }
      )
    }

    const signature = request.headers.get('ashby-signature')
    if (!signature) {
      logger.warn(`[${requestId}] Ashby webhook missing signature header`)
      return new NextResponse('Unauthorized - Missing Ashby signature', { status: 401 })
    }

    if (!validateAshbySignature(secretToken, signature, rawBody)) {
      logger.warn(`[${requestId}] Ashby signature verification failed`, {
        signatureLength: signature.length,
        secretLength: secretToken.length,
      })
      return new NextResponse('Unauthorized - Invalid Ashby signature', { status: 401 })
    }

    return null
  },

  async matchEvent({
    webhook,
    body,
    requestId,
    providerConfig,
  }: EventMatchContext): Promise<boolean> {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>
    const action = typeof obj?.action === 'string' ? obj.action : ''

    if (action === 'ping') {
      logger.debug(`[${requestId}] Ashby ping event received. Skipping execution.`, {
        webhookId: webhook.id,
        triggerId,
      })
      return false
    }

    if (!triggerId) return true

    const { isAshbyEventMatch } = await import('@/triggers/ashby/utils')
    if (!isAshbyEventMatch(triggerId, action)) {
      logger.debug(
        `[${requestId}] Ashby event mismatch for trigger ${triggerId}. Action: ${action || '(missing)'}. Skipping execution.`,
        {
          webhookId: webhook.id,
          triggerId,
          receivedAction: action,
        }
      )
      return false
    }

    return true
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    try {
      const providerConfig = getProviderConfig(ctx.webhook)
      const { apiKey, triggerId } = providerConfig as {
        apiKey?: string
        triggerId?: string
      }

      if (!apiKey) {
        throw new Error(
          'Ashby API Key is required. Please provide your API Key with apiKeysWrite permission in the trigger configuration.'
        )
      }

      if (!triggerId) {
        throw new Error('Trigger ID is required to create Ashby webhook.')
      }

      const { ASHBY_TRIGGER_ACTION_MAP } = await import('@/triggers/ashby/utils')
      const webhookType = ASHBY_TRIGGER_ACTION_MAP[triggerId]
      if (!webhookType) {
        throw new Error(
          `Unknown Ashby triggerId: ${triggerId}. Add it to ASHBY_TRIGGER_ACTION_MAP.`
        )
      }

      const notificationUrl = getNotificationUrl(ctx.webhook)
      const authString = Buffer.from(`${apiKey}:`).toString('base64')

      logger.info(`[${ctx.requestId}] Creating Ashby webhook`, {
        triggerId,
        webhookType,
        webhookId: ctx.webhook.id,
      })

      const secretToken = generateId()

      const requestBody: Record<string, unknown> = {
        requestUrl: notificationUrl,
        webhookType,
        secretToken,
      }

      const ashbyResponse = await fetch('https://api.ashbyhq.com/webhook.create', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authString}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const responseBody = await readAshbyManagementResponse(
        ashbyResponse,
        'Ashby webhook creation response'
      )

      if (!ashbyResponse.ok || !responseBody.success) {
        // Ashby documents two error shapes and uses both. Reading only
        // `errorInfo.message` misses the `errors: [{ message, parameter }]` form,
        // which is what a missing-permission failure arrives in - and the
        // duplicate-webhook branch below only fires when the message was
        // extracted, so losing it costs the user the actionable guidance.
        const errorMessage = ashbyErrorMessage(
          responseBody,
          (responseBody.message as string) || 'Unknown Ashby API error'
        )

        let userFriendlyMessage = 'Failed to create webhook subscription in Ashby'
        if (ashbyResponse.status === 401) {
          userFriendlyMessage =
            'Invalid Ashby API Key. Please verify your API Key is correct and has apiKeysWrite permission.'
        } else if (ashbyResponse.status === 403) {
          userFriendlyMessage =
            'Access denied. Please ensure your Ashby API Key has the apiKeysWrite permission.'
        } else if (/duplicate webhook/i.test(errorMessage)) {
          userFriendlyMessage =
            'A webhook for this URL and event already exists in Ashby. This usually happens when a previous save succeeded in Ashby but Sim failed to record it. Delete the duplicate webhook under Ashby Settings > API/Webhooks, then re-save this trigger.'
        } else if (errorMessage && errorMessage !== 'Unknown Ashby API error') {
          userFriendlyMessage = `Ashby error: ${errorMessage}`
        }

        throw new Error(userFriendlyMessage)
      }

      const results = responseBody.results as Record<string, unknown> | undefined
      const externalId = results?.id as string | undefined
      if (!externalId) {
        throw new Error('Ashby webhook creation succeeded but no webhook ID was returned')
      }

      logger.info(
        `[${ctx.requestId}] Successfully created Ashby webhook subscription ${externalId} for webhook ${ctx.webhook.id}`
      )
      return { providerConfigUpdates: { externalId, secretToken } }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(
        `[${ctx.requestId}] Exception during Ashby webhook creation for webhook ${ctx.webhook.id}.`,
        {
          message: err.message,
          stack: err.stack,
        }
      )
      throw error
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(ctx.webhook)
      const apiKey = config.apiKey as string | undefined
      const externalId = config.externalId as string | undefined

      if (!apiKey) {
        logger.warn(
          `[${ctx.requestId}] Missing apiKey for Ashby webhook deletion ${ctx.webhook.id}, skipping cleanup`
        )
        if (ctx.strict) throw new Error('Missing Ashby apiKey for webhook deletion')
        return
      }

      if (!externalId) {
        logger.warn(
          `[${ctx.requestId}] Missing externalId for Ashby webhook deletion ${ctx.webhook.id}, skipping cleanup`
        )
        if (ctx.strict) throw new Error('Missing Ashby externalId for webhook deletion')
        return
      }

      const authString = Buffer.from(`${apiKey}:`).toString('base64')

      const ashbyResponse = await fetch('https://api.ashbyhq.com/webhook.delete', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authString}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ webhookId: externalId }),
      })

      const responseBody = await readAshbyManagementResponse(
        ashbyResponse,
        'Ashby webhook deletion response'
      )

      /**
       * Ashby returns what would be a 4XX elsewhere as HTTP 200 with
       * `success: false`, so the status alone cannot separate a completed
       * delete from a rejected one. Branching on `ashbyResponse.ok` reported
       * every rejection as a successful cleanup while Sim dropped its own row
       * — and with no `webhook.list` endpoint, an orphan left behind that way
       * cannot be enumerated afterwards.
       *
       * Unlike `createSubscription`, an absent `success` field is treated as
       * success rather than failure: teardown runs on the undeploy path, and
       * failing closed on an unparseable body would wedge cleanup on a
       * response shape Ashby does not document.
       */
      const rejected = !ashbyResponse.ok || responseBody.success === false
      const errorMessage = ashbyErrorMessage(responseBody, `HTTP ${ashbyResponse.status}`)

      if (!rejected) {
        logger.info(
          `[${ctx.requestId}] Successfully deleted Ashby webhook subscription ${externalId}`
        )
      } else if (
        ashbyResponse.status === 404 ||
        isAshbyWebhookNotFound(responseBody, errorMessage)
      ) {
        logger.info(
          `[${ctx.requestId}] Ashby webhook ${externalId} not found during deletion (already removed)`
        )
      } else {
        logger.warn(
          `[${ctx.requestId}] Failed to delete Ashby webhook (non-fatal): ${errorMessage}`,
          { status: ashbyResponse.status, response: responseBody }
        )
        if (ctx.strict) {
          throw new Error(`Failed to delete Ashby webhook: ${errorMessage}`)
        }
      }
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Error deleting Ashby webhook (non-fatal)`, error)
      if (ctx.strict) throw error
    }
  },
}
