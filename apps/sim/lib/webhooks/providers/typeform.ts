import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
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

const logger = createLogger('WebhookProvider:Typeform')

function validateTypeformSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      return false
    }
    if (!signature.startsWith('sha256=')) {
      return false
    }
    const providedSignature = signature.substring(7)
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')
    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Typeform signature:', error)
    return false
  }
}

export const typeformHandler: WebhookProviderHandler = {
  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const formResponse = (b?.form_response || {}) as Record<string, unknown>
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const includeDefinition = providerConfig.includeDefinition === true
    return {
      input: {
        event_id: b?.event_id || '',
        event_type: b?.event_type || 'form_response',
        form_id: formResponse.form_id || '',
        token: formResponse.token || '',
        submitted_at: formResponse.submitted_at || '',
        landed_at: formResponse.landed_at || '',
        calculated: formResponse.calculated || {},
        variables: formResponse.variables || [],
        hidden: formResponse.hidden || {},
        answers: formResponse.answers || [],
        ...(includeDefinition ? { definition: formResponse.definition || {} } : {}),
        ending: formResponse.ending || {},
        raw: b,
      },
    }
  },

  verifyAuth: createHmacVerifier({
    configKey: 'secret',
    headerName: 'Typeform-Signature',
    validateFn: validateTypeformSignature,
    providerLabel: 'Typeform',
  }),

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const formId = config.formId as string | undefined
    const apiKey = config.apiKey as string | undefined
    const webhookTag = config.webhookTag as string | undefined
    const secret = config.secret as string | undefined

    if (!formId) {
      logger.warn(`[${ctx.requestId}] Missing formId for Typeform webhook ${ctx.webhook.id}`)
      throw new Error(
        'Form ID is required to create a Typeform webhook. Please provide a valid form ID.'
      )
    }

    if (!apiKey) {
      logger.warn(`[${ctx.requestId}] Missing apiKey for Typeform webhook ${ctx.webhook.id}`)
      throw new Error(
        'Personal Access Token is required to create a Typeform webhook. Please provide your Typeform API key.'
      )
    }

    const tag = webhookTag || `sim-${(ctx.webhook.id as string).substring(0, 8)}`
    const notificationUrl = getNotificationUrl(ctx.webhook)

    try {
      const typeformApiUrl = `https://api.typeform.com/forms/${formId}/webhooks/${tag}`

      const requestBody: Record<string, unknown> = {
        url: notificationUrl,
        enabled: true,
        verify_ssl: true,
        event_types: {
          form_response: true,
        },
      }

      if (secret) {
        requestBody.secret = secret
      }

      const typeformResponse = await fetch(typeformApiUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!typeformResponse.ok) {
        const responseBody = await typeformResponse.json().catch(() => ({}))
        const errorMessage =
          (responseBody as Record<string, string>).description ||
          (responseBody as Record<string, string>).message ||
          'Unknown error'

        logger.error(`[${ctx.requestId}] Typeform API error: ${errorMessage}`, {
          status: typeformResponse.status,
          response: responseBody,
        })

        let userFriendlyMessage = 'Failed to create Typeform webhook'
        if (typeformResponse.status === 401) {
          userFriendlyMessage =
            'Invalid Personal Access Token. Please verify your Typeform API key and try again.'
        } else if (typeformResponse.status === 403) {
          userFriendlyMessage =
            'Access denied. Please ensure you have a Typeform PRO or PRO+ account and the API key has webhook permissions.'
        } else if (typeformResponse.status === 404) {
          userFriendlyMessage = 'Form not found. Please verify the form ID is correct.'
        } else if (
          (responseBody as Record<string, string>).description ||
          (responseBody as Record<string, string>).message
        ) {
          userFriendlyMessage = `Typeform error: ${errorMessage}`
        }

        throw new Error(userFriendlyMessage)
      }

      const responseBody = await typeformResponse.json()
      logger.info(
        `[${ctx.requestId}] Successfully created Typeform webhook for webhook ${ctx.webhook.id} with tag ${tag}`,
        { webhookId: (responseBody as Record<string, unknown>).id }
      )

      if (!webhookTag && tag) {
        return { providerConfigUpdates: { webhookTag: tag } }
      }
      return {}
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes('Form ID') ||
          error.message.includes('Personal Access Token') ||
          error.message.includes('Typeform error'))
      ) {
        throw error
      }

      logger.error(
        `[${ctx.requestId}] Error creating Typeform webhook for webhook ${ctx.webhook.id}`,
        error
      )
      throw new Error(
        error instanceof Error
          ? error.message
          : 'Failed to create Typeform webhook. Please try again.'
      )
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(ctx.webhook)
      const formId = config.formId as string | undefined
      const apiKey = config.apiKey as string | undefined
      const webhookTag = config.webhookTag as string | undefined

      if (!formId || !apiKey) {
        logger.warn(
          `[${ctx.requestId}] Missing formId or apiKey for Typeform webhook deletion ${ctx.webhook.id}, skipping cleanup`
        )
        return
      }

      const tag = webhookTag || `sim-${(ctx.webhook.id as string).substring(0, 8)}`
      const typeformApiUrl = `https://api.typeform.com/forms/${formId}/webhooks/${tag}`

      const typeformResponse = await fetch(typeformApiUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!typeformResponse.ok && typeformResponse.status !== 404) {
        logger.warn(
          `[${ctx.requestId}] Failed to delete Typeform webhook (non-fatal): ${typeformResponse.status}`
        )
      } else {
        logger.info(`[${ctx.requestId}] Successfully deleted Typeform webhook with tag ${tag}`)
      }
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Error deleting Typeform webhook (non-fatal)`, error)
    }
  },
}
