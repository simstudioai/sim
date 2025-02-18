import { SlackIcon } from '@/components/icons'
import { SlackMessageResponse } from '@/tools/slack/message'
import { BlockConfig } from '../types'

export const SlackBlock: BlockConfig<SlackMessageResponse> = {
  type: 'slack',
  name: 'Slack',
  description: 'Send a message to Slack',
  category: 'tools',
  bgColor: '#611f69',
  icon: SlackIcon,
  subBlocks: [
    {
      id: 'channel',
      title: 'Channel',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Slack channel (e.g., #general)',
    },
    {
      id: 'text',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your alert message',
    },
    {
      id: 'apiKey',
      title: 'OAuth Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Slack OAuth token',
      password: true,
      connectionDroppable: false,
    },
  ],
  tools: {
    access: ['slack_message'],
  },
  inputs: {
    apiKey: { type: 'string', required: true },
    channel: { type: 'string', required: true },
    text: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        ts: 'string',
        channel: 'string',
      },
    },
  },
}
