import { MicrosoftTeamsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { MicrosoftTeamsResponse } from '@/tools/microsoft_teams/types'

export const MicrosoftTeamsBlock: BlockConfig<MicrosoftTeamsResponse> = {
  type: 'microsoft_teams',
  name: 'Microsoft Teams',
  description: 'Read, write, and create messages',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Microsoft Teams into the workflow. Can read and write chat messages, and read and write channel messages. Can be used in trigger mode to trigger a workflow when a message is sent to a chat or channel.',
  docsLink: 'https://docs.sim.ai/tools/microsoft_teams',
  category: 'tools',
  triggerAllowed: true,
  bgColor: '#E0E0E0',
  icon: MicrosoftTeamsIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Chat Messages', id: 'read_chat' },
        { label: 'Write Chat Message', id: 'write_chat' },
        { label: 'Read Channel Messages', id: 'read_channel' },
        { label: 'Write Channel Message', id: 'write_channel' },
      ],
      value: () => 'read_chat',
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'microsoft-teams',
      serviceId: 'microsoft-teams',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'User.Read',
        'Chat.Read',
        'Chat.ReadWrite',
        'Chat.ReadBasic',
        'Channel.ReadBasic.All',
        'ChannelMessage.Send',
        'ChannelMessage.Read.All',
        'Group.Read.All',
        'Group.ReadWrite.All',
        'Team.ReadBasic.All',
        'offline_access',
      ],
      placeholder: 'Select Microsoft account',
      required: true,
    },
    {
      id: 'teamId',
      title: 'Select Team',
      type: 'file-selector',
      layout: 'full',
      canonicalParamId: 'teamId',
      provider: 'microsoft-teams',
      serviceId: 'microsoft-teams',
      requiredScopes: [],
      placeholder: 'Select a team',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: ['read_channel', 'write_channel'] },
    },
    {
      id: 'manualTeamId',
      title: 'Team ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'teamId',
      placeholder: 'Enter team ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['read_channel', 'write_channel'] },
    },
    {
      id: 'chatId',
      title: 'Select Chat',
      type: 'file-selector',
      layout: 'full',
      canonicalParamId: 'chatId',
      provider: 'microsoft-teams',
      serviceId: 'microsoft-teams',
      requiredScopes: [],
      placeholder: 'Select a chat',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: ['read_chat', 'write_chat'] },
    },
    {
      id: 'manualChatId',
      title: 'Chat ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'chatId',
      placeholder: 'Enter chat ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['read_chat', 'write_chat'] },
    },
    {
      id: 'channelId',
      title: 'Select Channel',
      type: 'file-selector',
      layout: 'full',
      canonicalParamId: 'channelId',
      provider: 'microsoft-teams',
      serviceId: 'microsoft-teams',
      requiredScopes: [],
      placeholder: 'Select a channel',
      dependsOn: ['credential', 'teamId'],
      mode: 'basic',
      condition: { field: 'operation', value: ['read_channel', 'write_channel'] },
    },
    {
      id: 'manualChannelId',
      title: 'Channel ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'channelId',
      placeholder: 'Enter channel ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['read_channel', 'write_channel'] },
    },
    {
      id: 'content',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter message content',
      condition: { field: 'operation', value: ['write_chat', 'write_channel'] },
      required: true,
    },
    {
      id: 'triggerConfig',
      title: 'Trigger Configuration',
      type: 'trigger-config',
      layout: 'full',
      triggerProvider: 'microsoftteams',
      availableTriggers: ['microsoftteams_webhook'],
    },
  ],
  tools: {
    access: [
      'microsoft_teams_read_chat',
      'microsoft_teams_write_chat',
      'microsoft_teams_read_channel',
      'microsoft_teams_write_channel',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read_chat':
            return 'microsoft_teams_read_chat'
          case 'write_chat':
            return 'microsoft_teams_write_chat'
          case 'read_channel':
            return 'microsoft_teams_read_channel'
          case 'write_channel':
            return 'microsoft_teams_write_channel'
          default:
            return 'microsoft_teams_read_chat'
        }
      },
      params: (params) => {
        const {
          credential,
          operation,
          teamId,
          manualTeamId,
          chatId,
          manualChatId,
          channelId,
          manualChannelId,
          ...rest
        } = params

        const effectiveTeamId = (teamId || manualTeamId || '').trim()
        const effectiveChatId = (chatId || manualChatId || '').trim()
        const effectiveChannelId = (channelId || manualChannelId || '').trim()

        const baseParams = {
          ...rest,
          credential,
        }

        if (operation === 'read_chat' || operation === 'write_chat') {
          if (!effectiveChatId) {
            throw new Error('Chat ID is required. Please select a chat or enter a chat ID.')
          }
          return { ...baseParams, chatId: effectiveChatId }
        }

        if (operation === 'read_channel' || operation === 'write_channel') {
          if (!effectiveTeamId) {
            throw new Error('Team ID is required for channel operations.')
          }
          if (!effectiveChannelId) {
            throw new Error('Channel ID is required for channel operations.')
          }
          return { ...baseParams, teamId: effectiveTeamId, channelId: effectiveChannelId }
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Microsoft Teams access token' },
    messageId: { type: 'string', description: 'Message identifier' },
    chatId: { type: 'string', description: 'Chat identifier' },
    manualChatId: { type: 'string', description: 'Manual chat identifier' },
    channelId: { type: 'string', description: 'Channel identifier' },
    manualChannelId: { type: 'string', description: 'Manual channel identifier' },
    teamId: { type: 'string', description: 'Team identifier' },
    manualTeamId: { type: 'string', description: 'Manual team identifier' },
    content: { type: 'string', description: 'Message content' },
  },
  outputs: {
    content: { type: 'string', description: 'Formatted message content from chat/channel' },
    metadata: { type: 'json', description: 'Message metadata with full details' },
    messageCount: { type: 'number', description: 'Number of messages retrieved' },
    messages: { type: 'json', description: 'Array of message objects' },
    totalAttachments: { type: 'number', description: 'Total number of attachments' },
    attachmentTypes: { type: 'json', description: 'Array of attachment content types' },
    updatedContent: {
      type: 'boolean',
      description: 'Whether content was successfully updated/sent',
    },
    messageId: { type: 'string', description: 'ID of the created/sent message' },
    createdTime: { type: 'string', description: 'Timestamp when message was created' },
    url: { type: 'string', description: 'Web URL to the message' },
    sender: { type: 'string', description: 'Message sender display name' },
    messageTimestamp: { type: 'string', description: 'Individual message timestamp' },
    messageType: {
      type: 'string',
      description: 'Type of message (message, systemEventMessage, etc.)',
    },
    type: { type: 'string', description: 'Type of Teams message' },
    id: { type: 'string', description: 'Unique message identifier' },
    timestamp: { type: 'string', description: 'Message timestamp' },
    localTimestamp: { type: 'string', description: 'Local timestamp of the message' },
    serviceUrl: { type: 'string', description: 'Microsoft Teams service URL' },
    channelId: { type: 'string', description: 'Teams channel ID where the event occurred' },
    from_id: { type: 'string', description: 'User ID who sent the message' },
    from_name: { type: 'string', description: 'Username who sent the message' },
    conversation_id: { type: 'string', description: 'Conversation/thread ID' },
    text: { type: 'string', description: 'Message text content' },
  },
  triggers: {
    enabled: true,
    available: ['microsoftteams_webhook'],
  },
}
