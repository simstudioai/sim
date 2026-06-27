import { TelegramIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta, TriggerConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { Update } from '@/tools/telegram/types'

/**
 * Telegram Webhook Trigger
 * Supports both webhook mode (push) and polling mode (pull)
 */

export const telegramWebhookTrigger: TriggerConfig = {
  id: 'telegram_webhook',
  name: 'Telegram Webhook',
  description: 'Trigger workflow on Telegram updates (messages, callbacks, etc.)',
  category: 'communication',
  integrationType: IntegrationType.Communication,
  icon: TelegramIcon,
  authMode: AuthMode.BotToken,
  webhook: true,

  inputs: {
    botToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Telegram bot token (get from @BotFather)',
    },
    webhookUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'HTTPS URL where Telegram sends updates (auto-configured if using polling)',
    },
    pollMode: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Use polling instead of webhook (default: webhook)',
      value: () => false,
    },
    allowedUpdates: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Array of update types to accept (e.g., ["message", "callback_query"])',
    },
  },

  /**
   * Verify incoming webhook request
   * Telegram does NOT use HMAC signatures; just posts to the registered URL
   */
  verify: async (request: Request, _secret?: string): Promise<boolean> => {
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      return false
    }

    // Optional: verify Telegram Bot API secret token if set
    const botApiSecretToken = request.headers.get('x-telegram-bot-api-secret-token')
    if (botApiSecretToken && _secret && botApiSecretToken !== _secret) {
      return false
    }

    return true
  },

  /**
   * Parse incoming Telegram update
   */
  parse: async (request: Request): Promise<{ data: Update; dedupeId: string } | null> => {
    try {
      const update: Update = await request.json()

      // Deduplicate by update_id (Telegram can resend updates)
      const dedupeId = String(update.update_id)

      return { data: update, dedupeId }
    } catch {
      return null
    }
  },

  /**
   * Transform Telegram update to trigger output
   */
  output: (update: Update) => {
    // Extract the meaningful content from the update
    if (update.message) {
      return {
        type: 'message',
        from: update.message.from,
        chat: update.message.chat,
        message_id: update.message.message_id,
        text: update.message.text,
        entities: update.message.entities,
        timestamp: new Date(update.message.date * 1000),
        raw: update,
      }
    }

    if (update.callback_query) {
      return {
        type: 'callback_query',
        from: update.callback_query.from,
        chat_instance: update.callback_query.chat_instance,
        data: update.callback_query.data,
        message_id: update.callback_query.message?.message_id,
        timestamp: new Date(),
        raw: update,
      }
    }

    if (update.inline_query) {
      return {
        type: 'inline_query',
        from: update.inline_query.from,
        query: update.inline_query.query,
        offset: update.inline_query.offset,
        timestamp: new Date(),
        raw: update,
      }
    }

    if (update.chosen_inline_result) {
      return {
        type: 'chosen_inline_result',
        from: update.chosen_inline_result.from,
        result_id: update.chosen_inline_result.result_id,
        query: update.chosen_inline_result.query,
        timestamp: new Date(),
        raw: update,
      }
    }

    if (update.poll_answer) {
      return {
        type: 'poll_answer',
        poll_id: update.poll_answer.poll_id,
        user: update.poll_answer.user,
        option_ids: update.poll_answer.option_ids,
        timestamp: new Date(),
        raw: update,
      }
    }

    if (update.pre_checkout_query) {
      return {
        type: 'pre_checkout_query',
        from: update.pre_checkout_query.from,
        currency: update.pre_checkout_query.currency,
        total_amount: update.pre_checkout_query.total_amount,
        invoice_payload: update.pre_checkout_query.invoice_payload,
        timestamp: new Date(),
        raw: update,
      }
    }

    if (update.shipping_query) {
      return {
        type: 'shipping_query',
        from: update.shipping_query.from,
        invoice_payload: update.shipping_query.invoice_payload,
        shipping_address: update.shipping_query.shipping_address,
        timestamp: new Date(),
        raw: update,
      }
    }

    // Return raw update if no specific type matched
    return { raw: update, timestamp: new Date() }
  },

  subBlocks: [
    {
      id: 'triggerMode',
      title: 'Update Mode',
      type: 'dropdown',
      options: [
        {
          label: 'Webhook (recommended)',
          id: 'webhook',
        },
        {
          label: 'Polling',
          id: 'polling',
        },
      ],
      value: () => 'webhook',
      mode: 'trigger',
    },
    {
      id: 'webhookUrl',
      title: 'Webhook URL',
      type: 'short-input',
      placeholder: 'https://your-domain.com/webhook/telegram',
      description: 'HTTPS URL where Telegram will send updates',
      condition: {
        field: 'triggerMode',
        value: 'webhook',
      },
      mode: 'advanced',
    },
    {
      id: 'allowedUpdates',
      title: 'Allowed Update Types',
      type: 'json',
      placeholder: '["message", "callback_query", "inline_query"]',
      description: 'Leave empty to receive all updates',
      mode: 'advanced',
    },
  ],
}

/**
 * Block config metadata for Telegram trigger
 */
export const TelegramWebhookBlockMeta: BlockMeta = {
  docsLink: 'https://docs.sim.ai/integrations/telegram',
}
