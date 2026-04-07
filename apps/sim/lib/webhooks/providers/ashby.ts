import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import { generateId } from '@/lib/core/utils/uuid'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  DeleteSubscriptionContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Ashby')

function validateAshbySignature(secretToken: string, signature: string, body: string): boolean {
  try {
    if (!secretToken || !signature || !body) {
      return false
    }
    if (!signature.startsWith('sha256=')) {
      return false
    }
    const providedSignature = signature.substring(7)
    const computedHash = crypto.createHmac('sha256', secretToken).update(body, 'utf8').digest('hex')
    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Ashby signature:', error)
    return false
  }
}

export const ashbyHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return {
      input: {
        ...((b.data as Record<string, unknown>) || {}),
        action: b.action,
        data: b.data || {},
      },
    }
  },

  verifyAuth: createHmacVerifier({
    configKey: 'secretToken',
    headerName: 'ashby-signature',
    validateFn: validateAshbySignature,
    providerLabel: 'Ashby',
  }),

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

      const webhookTypeMap: Record<string, string> = {
        ashby_application_submit: 'applicationSubmit',
        ashby_candidate_stage_change: 'candidateStageChange',
        ashby_candidate_hire: 'candidateHire',
        ashby_candidate_delete: 'candidateDelete',
        ashby_job_create: 'jobCreate',
        ashby_offer_create: 'offerCreate',
      }

      const webhookType = webhookTypeMap[triggerId]
      if (!webhookType) {
        throw new Error(`Unknown Ashby triggerId: ${triggerId}. Add it to webhookTypeMap.`)
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

      const responseBody = (await ashbyResponse.json().catch(() => ({}))) as Record<string, unknown>

      if (!ashbyResponse.ok || !responseBody.success) {
        const errorInfo = responseBody.errorInfo as Record<string, string> | undefined
        const errorMessage =
          errorInfo?.message || (responseBody.message as string) || 'Unknown Ashby API error'

        let userFriendlyMessage = 'Failed to create webhook subscription in Ashby'
        if (ashbyResponse.status === 401) {
          userFriendlyMessage =
            'Invalid Ashby API Key. Please verify your API Key is correct and has apiKeysWrite permission.'
        } else if (ashbyResponse.status === 403) {
          userFriendlyMessage =
            'Access denied. Please ensure your Ashby API Key has the apiKeysWrite permission.'
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
        return
      }

      if (!externalId) {
        logger.warn(
          `[${ctx.requestId}] Missing externalId for Ashby webhook deletion ${ctx.webhook.id}, skipping cleanup`
        )
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

      if (ashbyResponse.ok) {
        await ashbyResponse.body?.cancel()
        logger.info(
          `[${ctx.requestId}] Successfully deleted Ashby webhook subscription ${externalId}`
        )
      } else if (ashbyResponse.status === 404) {
        await ashbyResponse.body?.cancel()
        logger.info(
          `[${ctx.requestId}] Ashby webhook ${externalId} not found during deletion (already removed)`
        )
      } else {
        const responseBody = await ashbyResponse.json().catch(() => ({}))
        logger.warn(
          `[${ctx.requestId}] Failed to delete Ashby webhook (non-fatal): ${ashbyResponse.status}`,
          { response: responseBody }
        )
      }
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Error deleting Ashby webhook (non-fatal)`, error)
    }
  },
}
