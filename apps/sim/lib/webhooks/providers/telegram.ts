import { createLogger } from '@sim/logger'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  AuthContext,
  DeleteSubscriptionContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Telegram')

export const telegramHandler: WebhookProviderHandler = {
  verifyAuth({ request, requestId }: AuthContext) {
    const userAgent = request.headers.get('user-agent')
    if (!userAgent) {
      logger.warn(
        `[${requestId}] Telegram webhook request has empty User-Agent header. This may be blocked by middleware.`
      )
    }
    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const rawMessage = (b?.message ||
      b?.edited_message ||
      b?.channel_post ||
      b?.edited_channel_post) as Record<string, unknown> | undefined

    const updateType = b.message
      ? 'message'
      : b.edited_message
        ? 'edited_message'
        : b.channel_post
          ? 'channel_post'
          : b.edited_channel_post
            ? 'edited_channel_post'
            : 'unknown'

    if (rawMessage) {
      const messageType = rawMessage.photo
        ? 'photo'
        : rawMessage.document
          ? 'document'
          : rawMessage.audio
            ? 'audio'
            : rawMessage.video
              ? 'video'
              : rawMessage.voice
                ? 'voice'
                : rawMessage.sticker
                  ? 'sticker'
                  : rawMessage.location
                    ? 'location'
                    : rawMessage.contact
                      ? 'contact'
                      : rawMessage.poll
                        ? 'poll'
                        : 'text'

      const from = rawMessage.from as Record<string, unknown> | undefined
      return {
        input: {
          message: {
            id: rawMessage.message_id,
            text: rawMessage.text,
            date: rawMessage.date,
            messageType,
            raw: rawMessage,
          },
          sender: from
            ? {
                id: from.id,
                username: from.username,
                firstName: from.first_name,
                lastName: from.last_name,
                languageCode: from.language_code,
                isBot: from.is_bot,
              }
            : null,
          updateId: b.update_id,
          updateType,
        },
      }
    }

    logger.warn('Unknown Telegram update type', {
      updateId: b.update_id,
      bodyKeys: Object.keys(b || {}),
    })

    return {
      input: {
        updateId: b.update_id,
        updateType,
      },
    }
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const botToken = config.botToken as string | undefined

    if (!botToken) {
      logger.warn(`[${ctx.requestId}] Missing botToken for Telegram webhook ${ctx.webhook.id}`)
      throw new Error(
        'Bot token is required to create a Telegram webhook. Please provide a valid Telegram bot token.'
      )
    }

    const notificationUrl = getNotificationUrl(ctx.webhook)
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`

    try {
      const telegramResponse = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TelegramBot/1.0',
        },
        body: JSON.stringify({ url: notificationUrl }),
      })

      const responseBody = await telegramResponse.json()
      if (!telegramResponse.ok || !responseBody.ok) {
        const errorMessage =
          responseBody.description ||
          `Failed to create Telegram webhook. Status: ${telegramResponse.status}`
        logger.error(`[${ctx.requestId}] ${errorMessage}`, { response: responseBody })

        let userFriendlyMessage = 'Failed to create Telegram webhook'
        if (telegramResponse.status === 401) {
          userFriendlyMessage =
            'Invalid bot token. Please verify that the bot token is correct and try again.'
        } else if (responseBody.description) {
          userFriendlyMessage = `Telegram error: ${responseBody.description}`
        }

        throw new Error(userFriendlyMessage)
      }

      logger.info(
        `[${ctx.requestId}] Successfully created Telegram webhook for webhook ${ctx.webhook.id}`
      )
      return {}
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes('Bot token') || error.message.includes('Telegram error'))
      ) {
        throw error
      }

      logger.error(
        `[${ctx.requestId}] Error creating Telegram webhook for webhook ${ctx.webhook.id}`,
        error
      )
      throw new Error(
        error instanceof Error
          ? error.message
          : 'Failed to create Telegram webhook. Please try again.'
      )
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(ctx.webhook)
      const botToken = config.botToken as string | undefined

      if (!botToken) {
        logger.warn(
          `[${ctx.requestId}] Missing botToken for Telegram webhook deletion ${ctx.webhook.id}`
        )
        return
      }

      const telegramApiUrl = `https://api.telegram.org/bot${botToken}/deleteWebhook`
      const telegramResponse = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const responseBody = await telegramResponse.json()
      if (!telegramResponse.ok || !responseBody.ok) {
        const errorMessage =
          responseBody.description ||
          `Failed to delete Telegram webhook. Status: ${telegramResponse.status}`
        logger.error(`[${ctx.requestId}] ${errorMessage}`, { response: responseBody })
      } else {
        logger.info(
          `[${ctx.requestId}] Successfully deleted Telegram webhook for webhook ${ctx.webhook.id}`
        )
      }
    } catch (error) {
      logger.error(
        `[${ctx.requestId}] Error deleting Telegram webhook for webhook ${ctx.webhook.id}`,
        error
      )
    }
  },
}
