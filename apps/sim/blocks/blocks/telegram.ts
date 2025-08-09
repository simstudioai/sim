import { TelegramIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { TelegramMessageResponse } from '@/tools/telegram/types'

export const TelegramBlock: BlockConfig<TelegramMessageResponse> = {
  type: 'telegram',
  name: 'Telegram',
  description: 'Send messages through Telegram or trigger workflows from Telegram events',
  longDescription:
    'Send messages to any Telegram channel using your Bot API key or trigger workflows from Telegram bot messages. Integrate automated notifications and alerts into your workflow to keep your team informed.',
  docsLink: 'https://docs.sim.ai/tools/telegram',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: TelegramIcon,
  subBlocks: [
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Telegram Bot Token',
      password: true,
      connectionDroppable: false,
      description: `Getting Bot Token:
1. If you haven't already, message "/newbot" to @BotFather
2. Choose a name for your bot
3. Copy the token it provides and paste it here`,
      required: true,
    },
    {
      id: 'chatId',
      title: 'Chat ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Telegram Chat ID',
      description: `Getting Chat ID:
1. Add your bot as a member to desired Telegram channel
2. Send any message to the channel (e.g. "I love Sim")
3. Visit https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
4. Look for the chat field in the JSON response at the very bottomwhere you'll find the chat ID`,
      required: true,
    },
    {
      id: 'text',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter the message to send',
      required: true,
    },
    // TRIGGER MODE: Trigger configuration (only shown when trigger mode is active)
    {
      id: 'triggerConfig',
      title: 'Trigger Configuration',
      type: 'trigger-config',
      layout: 'full',
      triggerProvider: 'telegram',
      availableTriggers: ['telegram_webhook'],
    },
  ],
  tools: {
    access: ['telegram_message'],
  },
  inputs: {
    botToken: { type: 'string', description: 'Telegram bot token' },
    chatId: { type: 'string', description: 'Chat identifier' },
    text: { type: 'string', description: 'Message text' },
  },
  outputs: {
    // Send message operation outputs
    ok: { type: 'boolean', description: 'API response success status' },
    result: { type: 'json', description: 'Complete message result object from Telegram API' },
    // Specific result fields
    messageId: { type: 'number', description: 'Sent message ID' },
    chatId: { type: 'number', description: 'Chat ID where message was sent' },
    chatType: { type: 'string', description: 'Type of chat (private, group, supergroup, channel)' },
    username: { type: 'string', description: 'Chat username (if available)' },
    messageDate: { type: 'number', description: 'Unix timestamp of sent message' },
    messageText: { type: 'string', description: 'Text content of sent message' },
    // Webhook trigger outputs (incoming messages)
    update_id: { type: 'number', description: 'Unique identifier for the update' },
    message_id: { type: 'number', description: 'Unique message identifier from webhook' },
    from_id: { type: 'number', description: 'User ID who sent the message' },
    from_username: { type: 'string', description: 'Username of the sender' },
    from_first_name: { type: 'string', description: 'First name of the sender' },
    from_last_name: { type: 'string', description: 'Last name of the sender' },
    chat_id: { type: 'number', description: 'Unique identifier for the chat' },
    chat_type: {
      type: 'string',
      description: 'Type of chat (private, group, supergroup, channel)',
    },
    chat_title: { type: 'string', description: 'Title of the chat (for groups and channels)' },
    text: { type: 'string', description: 'Message text content from webhook' },
    date: { type: 'number', description: 'Date the message was sent (Unix timestamp)' },
    entities: {
      type: 'json',
      description: 'Special entities in the message (mentions, hashtags, etc.)',
    },
  },
  triggers: {
    enabled: true,
    available: ['telegram_webhook'],
  },
}
