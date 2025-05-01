import { TelegramIcon } from '@/components/icons'
import { TelegramMessageResponse } from '@/tools/telegram/types'
import { BlockConfig } from '../types'

export const TelegramBlock: BlockConfig<TelegramMessageResponse> = {
  type: 'telegram',
  name: 'Telegram',
  description: 'Send a message through Telegram',
  longDescription:
    'Send messages to any Telegram channel using your Bot API key. Integrate automated notifications and alerts into your workflow to keep your team informed.',
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
    },
    {
      id: 'chatId',
      title: 'Chat ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Telegram Chat ID',
      description: `Getting Chat ID:
1. Add your bot as a member to desired Telegram channel
2. Send any message to the channel (e.g. "I love Sim Studio")
3. Visit https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
4. Look for the chat field in the JSON response at the very bottomwhere you'll find the chat ID`,
    },
    {
      id: 'text',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter the message to send',
    },
  ],
  tools: {
    access: ['telegram_message'],
  },
  inputs: {
    botToken: { type: 'string', required: true },
    chatId: { type: 'string', required: true },
    text: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        ok: 'boolean',
        result: 'json'
      }
    }
  },
}
