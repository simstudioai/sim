import { SlackIcon } from '@/components/icons'
import type { SlackMessageResponse } from '@/tools/slack/types'
import type { BlockConfig } from '../types'

type SlackResponse = SlackMessageResponse

export const SlackBlock: BlockConfig<SlackResponse> = {
  type: 'slack',
  name: 'Slack',
  description: 'Send messages to Slack',
  longDescription:
    "Comprehensive Slack integration with OAuth authentication. Send formatted messages using Slack's mrkdwn syntax or Block Kit.",
  docsLink: 'https://docs.simstudio.ai/tools/slack',
  category: 'tools',
  bgColor: '#611f69',
  icon: SlackIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [{ label: 'Send Message', id: 'send' }],
      value: () => 'send',
    },
    {
      id: 'authMethod',
      title: 'Authentication Method',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Sim Studio Bot', id: 'oauth' },
        { label: 'Custom Bot', id: 'bot_token' },
      ],
      value: () => 'oauth',
    },
    {
      id: 'credential',
      title: 'Slack Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'slack',
      serviceId: 'slack',
      requiredScopes: [
        'channels:read',
        'groups:read',
        'chat:write',
        'chat:write.public',
        'users:read',
        'files:read',
        'links:read',
        'links:write',
      ],
      placeholder: 'Select Slack workspace',
      condition: {
        field: 'authMethod',
        value: 'oauth',
      },
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Slack bot token (xoxb-...)',
      password: true,
      condition: {
        field: 'authMethod',
        value: 'bot_token',
      },
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'channel-selector',
      layout: 'full',
      provider: 'slack',
      placeholder: 'Select Slack channel',
    },
    {
      id: 'text',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your message (supports Slack mrkdwn)',
    },
  ],
  tools: {
    access: ['slack_message'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send':
            return 'slack_message'
          default:
            throw new Error(`Invalid Slack operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, authMethod, botToken, operation, ...rest } = params

        const baseParams = {
          ...rest,
        }

        // Handle authentication based on method
        if (authMethod === 'bot_token') {
          if (!botToken) {
            throw new Error('Bot token is required when using bot token authentication')
          }
          baseParams.accessToken = botToken
        } else {
          // Default to OAuth
          if (!credential) {
            throw new Error('Slack account credential is required when using Sim Studio Bot')
          }
          baseParams.credential = credential
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    authMethod: { type: 'string', required: true },
    credential: { type: 'string', required: false },
    botToken: { type: 'string', required: false },
    channel: { type: 'string', required: true },
    text: { type: 'string', required: true },
  },
  outputs: {
    ts: 'string',
    channel: 'string',
  },
}
