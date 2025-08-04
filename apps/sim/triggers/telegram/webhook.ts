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
    update_id: {
      type: 'number',
      description: 'Unique identifier for the update',
    },
    message_id: {
      type: 'number',
      description: 'Unique message identifier',
    },
    from_id: {
      type: 'number',
      description: 'User ID who sent the message',
    },
    from_username: {
      type: 'string',
      description: 'Username of the sender',
    },
    from_first_name: {
      type: 'string',
      description: 'First name of the sender',
    },
    from_last_name: {
      type: 'string',
      description: 'Last name of the sender',
    },
    chat_id: {
      type: 'number',
      description: 'Unique identifier for the chat',
    },
    chat_type: {
      type: 'string',
      description: 'Type of chat (private, group, supergroup, channel)',
    },
    chat_title: {
      type: 'string',
      description: 'Title of the chat (for groups and channels)',
    },
    text: {
      type: 'string',
      description: 'Message text content',
    },
    date: {
      type: 'number',
      description: 'Date the message was sent (Unix timestamp)',
    },
    entities: {
      type: 'string',
      description: 'Special entities in the message (mentions, hashtags, etc.) as JSON string',
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
