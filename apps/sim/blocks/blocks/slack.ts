import { SlackIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { SlackResponse } from '@/tools/slack/types'

export const SlackBlock: BlockConfig<SlackResponse> = {
  type: 'slack',
  name: 'Slack',
  description: 'Send messages to Slack or trigger workflows from Slack events',
  longDescription:
    "Comprehensive Slack integration with OAuth authentication. Send formatted messages using Slack's mrkdwn syntax or trigger workflows from Slack events like mentions and messages.",
  docsLink: 'https://docs.sim.ai/tools/slack',
  category: 'tools',
  bgColor: '#611f69',
  icon: SlackIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Send Message', id: 'send' },
        { label: 'Create Canvas', id: 'canvas' },
        { label: 'Read Messages', id: 'read' },
      ],
      value: () => 'send',
    },
    {
      id: 'authMethod',
      title: 'Authentication Method',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Sim Bot', id: 'oauth' },
        { label: 'Custom Bot', id: 'bot_token' },
      ],
      value: () => 'oauth',
      required: true,
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
        'channels:history',
        'groups:read',
        'groups:history',
        'chat:write',
        'chat:write.public',
        'users:read',
        'files:write',
        'canvases:write',
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
      canonicalParamId: 'channel',
      provider: 'slack',
      placeholder: 'Select Slack channel',
      mode: 'basic',
      dependsOn: ['credential', 'authMethod'],
    },
    // Manual channel ID input (advanced mode)
    {
      id: 'manualChannel',
      title: 'Channel ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'channel',
      placeholder: 'Enter Slack channel ID (e.g., C1234567890)',
      mode: 'advanced',
    },
    {
      id: 'text',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your message (supports Slack mrkdwn)',
      condition: {
        field: 'operation',
        value: 'send',
      },
      required: true,
    },
    // Canvas specific fields
    {
      id: 'title',
      title: 'Canvas Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter canvas title',
      condition: {
        field: 'operation',
        value: 'canvas',
      },
      required: true,
    },
    {
      id: 'content',
      title: 'Canvas Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter canvas content (markdown supported)',
      condition: {
        field: 'operation',
        value: 'canvas',
      },
      required: true,
    },
    // Message Reader specific fields
    {
      id: 'limit',
      title: 'Message Limit',
      type: 'short-input',
      layout: 'half',
      placeholder: '15',
      condition: {
        field: 'operation',
        value: 'read',
      },
    },
    {
      id: 'oldest',
      title: 'Oldest Timestamp',
      type: 'short-input',
      layout: 'half',
      placeholder: 'ISO 8601 timestamp',
      condition: {
        field: 'operation',
        value: 'read',
      },
    },
    // TRIGGER MODE: Trigger configuration (only shown when trigger mode is active)
    {
      id: 'triggerConfig',
      title: 'Trigger Configuration',
      type: 'trigger-config',
      layout: 'full',
      triggerProvider: 'slack',
      availableTriggers: ['slack_webhook'],
    },
  ],
  tools: {
    access: ['slack_message', 'slack_canvas', 'slack_message_reader'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send':
            return 'slack_message'
          case 'canvas':
            return 'slack_canvas'
          case 'read':
            return 'slack_message_reader'
          default:
            throw new Error(`Invalid Slack operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          authMethod,
          botToken,
          operation,
          channel,
          manualChannel,
          title,
          content,
          limit,
          oldest,
          ...rest
        } = params

        // Handle both selector and manual channel input
        const effectiveChannel = (channel || manualChannel || '').trim()

        if (!effectiveChannel) {
          throw new Error('Channel is required.')
        }

        const baseParams: Record<string, any> = {
          channel: effectiveChannel,
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
            throw new Error('Slack account credential is required when using Sim Bot')
          }
          baseParams.credential = credential
        }

        // Handle operation-specific params
        switch (operation) {
          case 'send':
            if (!rest.text) {
              throw new Error('Message text is required for send operation')
            }
            baseParams.text = rest.text
            break

          case 'canvas':
            if (!title || !content) {
              throw new Error('Title and content are required for canvas operation')
            }
            baseParams.title = title
            baseParams.content = content
            break

          case 'read':
            if (limit) {
              const parsedLimit = Number.parseInt(limit, 10)
              baseParams.limit = !Number.isNaN(parsedLimit) ? parsedLimit : 10
            } else {
              baseParams.limit = 10
            }
            if (oldest) {
              baseParams.oldest = oldest
            }
            break
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    authMethod: { type: 'string', description: 'Authentication method' },
    credential: { type: 'string', description: 'Slack access token' },
    botToken: { type: 'string', description: 'Bot token' },
    channel: { type: 'string', description: 'Channel identifier' },
    manualChannel: { type: 'string', description: 'Manual channel identifier' },
    text: { type: 'string', description: 'Message text' },
    title: { type: 'string', description: 'Canvas title' },
    content: { type: 'string', description: 'Canvas content' },
    limit: { type: 'string', description: 'Message limit' },
    oldest: { type: 'string', description: 'Oldest timestamp' },
  },
  outputs: {
    // slack_message outputs
    ts: { type: 'string', description: 'Message timestamp returned by Slack API' },
    channel: { type: 'string', description: 'Channel identifier where message was sent' },

    // slack_canvas outputs
    canvas_id: { type: 'string', description: 'Canvas identifier for created canvases' },
    title: { type: 'string', description: 'Canvas title' },

    // slack_message_reader outputs
    messages: {
      type: 'json',
      description: 'Array of message objects',
    },

    // Trigger outputs (when used as webhook trigger)
    event_type: { type: 'string', description: 'Type of Slack event that triggered the workflow' },
    channel_name: { type: 'string', description: 'Human-readable channel name' },
    user_name: { type: 'string', description: 'Username who triggered the event' },
    team_id: { type: 'string', description: 'Slack workspace/team ID' },
    event_id: { type: 'string', description: 'Unique event identifier for the trigger' },
  },
  // New: Trigger capabilities
  triggers: {
    enabled: true,
    available: ['slack_webhook'],
  },
}
