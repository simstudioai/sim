import { TelegramIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { TelegramMessageResponse } from '@/tools/telegram/types'

export const TelegramBlock: BlockConfig<TelegramMessageResponse> = {
  type: 'telegram',
  name: 'Telegram',
  description: 'Send a message through Telegram',
  longDescription:
    'Send messages to any Telegram channel using your Bot API key. Integrate automated notifications and alerts into your workflow to keep your team informed.',
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
    ok: { type: 'boolean', description: 'Success status' },
    result: { type: 'json', description: 'Message result' },
  },
}
