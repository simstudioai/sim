import { TelegramIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const telegramWebhookTrigger: TriggerConfig = {
  id: 'telegram_webhook',
  name: 'Telegram Webhook',
  provider: 'telegram',
  description: 'Trigger workflow from Telegram bot messages and events',
  version: '1.0.0',
  icon: TelegramIcon,

  configFields: {
    botToken: {
      type: 'string',
      label: 'Bot Token',
      placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
      description: 'Your Telegram Bot Token from BotFather',
      required: true,
      isSecret: true,
    },
  },

  outputs: {
    // Matches the formatted payload built in `formatWebhookInput` for provider "telegram"
    // Supports tags like <telegram.message.text> and deep paths like <telegram.message.raw.chat.id>
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

  instructions: [
    'Message "/newbot" to <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" class="text-primary underline transition-colors hover:text-primary/80">@BotFather</a> in Telegram to create a bot and copy its token.',
    'Enter your Bot Token above.',
    'Save settings and any message sent to your bot will trigger the workflow.',
  ],

  samplePayload: {
    update_id: 123456789,
    message: {
      message_id: 123,
      from: {
        id: 987654321,
        is_bot: false,
        first_name: 'John',
        last_name: 'Doe',
        username: 'johndoe',
        language_code: 'en',
      },
      chat: {
        id: 987654321,
        first_name: 'John',
        last_name: 'Doe',
        username: 'johndoe',
        type: 'private',
      },
      date: 1234567890,
      text: 'Hello from Telegram!',
      entities: [
        {
          offset: 0,
          length: 5,
          type: 'bold',
        },
      ],
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
