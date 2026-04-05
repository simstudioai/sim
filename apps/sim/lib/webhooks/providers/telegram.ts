import { createLogger } from '@sim/logger'
import type {
  AuthContext,
  FormatInputContext,
  FormatInputResult,
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
}
