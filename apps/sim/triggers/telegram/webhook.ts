import { TelegramIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const telegramWebhookTrigger: TriggerConfig = {
  id: 'telegram_webhook',
  name: 'Telegram Webhook',
  provider: 'telegram',
  description: 'Trigger workflow from Telegram bot messages and events',
  version: '1.0.0',
  icon: TelegramIcon,

  subBlocks: [
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
      description: 'Your Telegram Bot Token from BotFather',
      password: true,
      required: true,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Message "/newbot" to <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" class="text-muted-foreground underline transition-colors hover:text-muted-foreground/80">@BotFather</a> in Telegram to create a bot and copy its token.',
        'Enter your Bot Token above.',
        'Save settings and any message sent to your bot will trigger the workflow.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'telegram_webhook',
    },
  ],

  outputs: {
    message: {
      id: {
        type: 'number',
        description: 'Telegram message ID',
      },
      text: {
        type: 'string',
        description: 'Message text content (if present)',
      },
      date: {
        type: 'number',
        description: 'Date the message was sent (Unix timestamp)',
      },
      messageType: {
        type: 'string',
        description:
          'Detected content type: text, photo, document, audio, video, voice, sticker, location, contact, poll',
      },
      raw: {
        message_id: {
          type: 'number',
          description: 'Original Telegram message_id',
        },
        date: {
          type: 'number',
          description: 'Original Telegram message date (Unix timestamp)',
        },
        text: {
          type: 'string',
          description: 'Original Telegram text (if present)',
        },
        caption: {
          type: 'string',
          description: 'Original Telegram caption (if present)',
        },
        chat: {
          id: { type: 'number', description: 'Chat identifier' },
          username: { type: 'string', description: 'Chat username (if available)' },
          first_name: { type: 'string', description: 'First name (for private chats)' },
          last_name: { type: 'string', description: 'Last name (for private chats)' },
        },
        from: {
          id: { type: 'number', description: 'Sender user ID' },
          is_bot: { type: 'boolean', description: 'Whether the sender is a bot' },
          first_name: { type: 'string', description: 'Sender first name' },
          last_name: { type: 'string', description: 'Sender last name' },
          language_code: { type: 'string', description: 'Sender language code (if available)' },
        },
      },
    },
    sender: {
      id: { type: 'number', description: 'Sender user ID' },
      firstName: { type: 'string', description: 'Sender first name' },
      lastName: { type: 'string', description: 'Sender last name' },
      languageCode: { type: 'string', description: 'Sender language code (if available)' },
      isBot: { type: 'boolean', description: 'Whether the sender is a bot' },
    },
    updateId: {
      type: 'number',
      description: 'Update ID for this webhook delivery',
    },
    updateType: {
      type: 'string',
      description:
        'Type of update: message, edited_message, channel_post, edited_channel_post, unknown',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
