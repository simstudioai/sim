import { MicrosoftTeamsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { MicrosoftTeamsResponse } from '@/tools/microsoft_teams/types'
import { getTrigger } from '@/triggers'

export const MicrosoftTeamsBlock: BlockConfig<MicrosoftTeamsResponse> = {
  type: 'microsoft_teams',
  name: 'Microsoft Teams',
  description: 'Manage messages, reactions, and members in Teams',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Microsoft Teams into the workflow. Read, write, update, and delete chat and channel messages. Reply to messages, add reactions, and list team/channel members. Can be used in trigger mode to trigger a workflow when a message is sent to a chat or channel. To mention users in messages, wrap their name in `<at>` tags: `<at>userName</at>`',
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
      options: [
        { label: 'Read Chat Messages', id: 'read_chat' },
        { label: 'Write Chat Message', id: 'write_chat' },
        { label: 'Update Chat Message', id: 'update_chat_message' },
        { label: 'Delete Chat Message', id: 'delete_chat_message' },
        { label: 'Read Channel Messages', id: 'read_channel' },
        { label: 'Write Channel Message', id: 'write_channel' },
        { label: 'Update Channel Message', id: 'update_channel_message' },
        { label: 'Delete Channel Message', id: 'delete_channel_message' },
        { label: 'Reply to Channel Message', id: 'reply_to_message' },
        { label: 'Get Message', id: 'get_message' },
        { label: 'Add Reaction', id: 'set_reaction' },
        { label: 'Remove Reaction', id: 'unset_reaction' },
        { label: 'List Team Members', id: 'list_team_members' },
        { label: 'List Channel Members', id: 'list_channel_members' },
      ],
      value: () => 'read_chat',
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
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
        'ChatMessage.Send',
        'Channel.ReadBasic.All',
        'ChannelMessage.Send',
        'ChannelMessage.Read.All',
        'ChannelMessage.ReadWrite',
        'ChannelMember.Read.All',
        'Group.Read.All',
        'Group.ReadWrite.All',
        'Team.ReadBasic.All',
        'TeamMember.Read.All',
        'offline_access',
        'Files.Read',
        'Sites.Read.All',
      ],
      placeholder: 'Select Microsoft account',
      required: true,
    },
    {
      id: 'teamId',
      title: 'Select Team',
      type: 'file-selector',
      canonicalParamId: 'teamId',
      provider: 'microsoft-teams',
      serviceId: 'microsoft-teams',
      requiredScopes: [],
      placeholder: 'Select a team',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'read_channel',
          'write_channel',
          'update_channel_message',
          'delete_channel_message',
          'reply_to_message',
          'list_team_members',
          'list_channel_members',
        ],
      },
    },
    {
      id: 'manualTeamId',
      title: 'Team ID',
      type: 'short-input',
      canonicalParamId: 'teamId',
      placeholder: 'Enter team ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'read_channel',
          'write_channel',
          'update_channel_message',
          'delete_channel_message',
          'reply_to_message',
          'list_team_members',
          'list_channel_members',
        ],
      },
    },
    {
      id: 'chatId',
      title: 'Select Chat',
      type: 'file-selector',
      canonicalParamId: 'chatId',
      provider: 'microsoft-teams',
      serviceId: 'microsoft-teams',
      requiredScopes: [],
      placeholder: 'Select a chat',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['read_chat', 'write_chat', 'update_chat_message', 'delete_chat_message'],
      },
    },
    {
      id: 'manualChatId',
      title: 'Chat ID',
      type: 'short-input',
      canonicalParamId: 'chatId',
      placeholder: 'Enter chat ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['read_chat', 'write_chat', 'update_chat_message', 'delete_chat_message'],
      },
    },
    {
      id: 'channelId',
      title: 'Select Channel',
      type: 'file-selector',
      canonicalParamId: 'channelId',
      provider: 'microsoft-teams',
      serviceId: 'microsoft-teams',
      requiredScopes: [],
      placeholder: 'Select a channel',
      dependsOn: ['credential', 'teamId'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'read_channel',
          'write_channel',
          'update_channel_message',
          'delete_channel_message',
          'reply_to_message',
          'list_channel_members',
        ],
      },
    },
    {
      id: 'manualChannelId',
      title: 'Channel ID',
      type: 'short-input',
      canonicalParamId: 'channelId',
      placeholder: 'Enter channel ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'read_channel',
          'write_channel',
          'update_channel_message',
          'delete_channel_message',
          'reply_to_message',
          'list_channel_members',
        ],
      },
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Enter message ID',
      condition: {
        field: 'operation',
        value: [
          'update_chat_message',
          'delete_chat_message',
          'update_channel_message',
          'delete_channel_message',
          'reply_to_message',
          'get_message',
          'set_reaction',
          'unset_reaction',
        ],
      },
      required: true,
    },
    {
      id: 'content',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Enter message content',
      condition: {
        field: 'operation',
        value: [
          'write_chat',
          'write_channel',
          'update_chat_message',
          'update_channel_message',
          'reply_to_message',
        ],
      },
      required: true,
    },
    {
      id: 'reactionType',
      title: 'Reaction',
      type: 'short-input',
      placeholder: 'Enter emoji (e.g., ❤️, 👍, 😊)',
      condition: {
        field: 'operation',
        value: ['set_reaction', 'unset_reaction'],
      },
      required: true,
    },
    // File upload (basic mode)
    {
      id: 'attachmentFiles',
      title: 'Attachments',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Upload files to attach',
      condition: { field: 'operation', value: ['write_chat', 'write_channel'] },
      mode: 'basic',
      multiple: true,
      required: false,
    },
    // Variable reference (advanced mode)
    {
      id: 'files',
      title: 'File Attachments',
      type: 'short-input',
      canonicalParamId: 'files',
      placeholder: 'Reference files from previous blocks',
      condition: { field: 'operation', value: ['write_chat', 'write_channel'] },
      mode: 'advanced',
      required: false,
    },
    ...getTrigger('microsoftteams_webhook').subBlocks,
    ...getTrigger('microsoftteams_chat_subscription').subBlocks,
  ],
  tools: {
    access: [
      'microsoft_teams_read_chat',
      'microsoft_teams_write_chat',
      'microsoft_teams_read_channel',
      'microsoft_teams_write_channel',
      'microsoft_teams_update_chat_message',
      'microsoft_teams_update_channel_message',
      'microsoft_teams_delete_chat_message',
      'microsoft_teams_delete_channel_message',
      'microsoft_teams_reply_to_message',
      'microsoft_teams_get_message',
      'microsoft_teams_set_reaction',
      'microsoft_teams_unset_reaction',
      'microsoft_teams_list_team_members',
      'microsoft_teams_list_channel_members',
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
          case 'update_chat_message':
            return 'microsoft_teams_update_chat_message'
          case 'update_channel_message':
            return 'microsoft_teams_update_channel_message'
          case 'delete_chat_message':
            return 'microsoft_teams_delete_chat_message'
          case 'delete_channel_message':
            return 'microsoft_teams_delete_channel_message'
          case 'reply_to_message':
            return 'microsoft_teams_reply_to_message'
          case 'get_message':
            return 'microsoft_teams_get_message'
          case 'set_reaction':
            return 'microsoft_teams_set_reaction'
          case 'unset_reaction':
            return 'microsoft_teams_unset_reaction'
          case 'list_team_members':
            return 'microsoft_teams_list_team_members'
          case 'list_channel_members':
            return 'microsoft_teams_list_channel_members'
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
          attachmentFiles,
          files,
          messageId,
          reactionType,
          ...rest
        } = params

        const effectiveTeamId = (teamId || manualTeamId || '').trim()
        const effectiveChatId = (chatId || manualChatId || '').trim()
        const effectiveChannelId = (channelId || manualChannelId || '').trim()

        const baseParams: Record<string, any> = {
          ...rest,
          credential,
        }

        // Add files if provided
        const fileParam = attachmentFiles || files
        if (fileParam && (operation === 'write_chat' || operation === 'write_channel')) {
          baseParams.files = fileParam
        }

        // Add messageId if provided
        if (messageId) {
          baseParams.messageId = messageId
        }

        // Add reactionType if provided
        if (reactionType) {
          baseParams.reactionType = reactionType
        }

        // Chat operations
        if (
          operation === 'read_chat' ||
          operation === 'write_chat' ||
          operation === 'update_chat_message' ||
          operation === 'delete_chat_message'
        ) {
          if (!effectiveChatId) {
            throw new Error('Chat ID is required. Please select a chat or enter a chat ID.')
          }
          return { ...baseParams, chatId: effectiveChatId }
        }

        // Channel operations
        if (
          operation === 'read_channel' ||
          operation === 'write_channel' ||
          operation === 'update_channel_message' ||
          operation === 'delete_channel_message' ||
          operation === 'reply_to_message'
        ) {
          if (!effectiveTeamId) {
            throw new Error('Team ID is required for channel operations.')
          }
          if (!effectiveChannelId) {
            throw new Error('Channel ID is required for channel operations.')
          }
          return { ...baseParams, teamId: effectiveTeamId, channelId: effectiveChannelId }
        }

        // Team member operations
        if (operation === 'list_team_members') {
          if (!effectiveTeamId) {
            throw new Error('Team ID is required for team member operations.')
          }
          return { ...baseParams, teamId: effectiveTeamId }
        }

        // Channel member operations
        if (operation === 'list_channel_members') {
          if (!effectiveTeamId) {
            throw new Error('Team ID is required for channel member operations.')
          }
          if (!effectiveChannelId) {
            throw new Error('Channel ID is required for channel member operations.')
          }
          return { ...baseParams, teamId: effectiveTeamId, channelId: effectiveChannelId }
        }

        // Operations that work with either chat or channel (get_message, reactions)
        // These tools handle the routing internally based on what IDs are provided
        if (
          operation === 'get_message' ||
          operation === 'set_reaction' ||
          operation === 'unset_reaction'
        ) {
          if (effectiveChatId) {
            return { ...baseParams, chatId: effectiveChatId }
          }
          if (effectiveTeamId && effectiveChannelId) {
            return { ...baseParams, teamId: effectiveTeamId, channelId: effectiveChannelId }
          }
          throw new Error(
            'Either Chat ID or both Team ID and Channel ID are required for this operation.'
          )
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Microsoft Teams access token' },
    messageId: {
      type: 'string',
      description: 'Message identifier for update/delete/reply/reaction operations',
    },
    chatId: { type: 'string', description: 'Chat identifier' },
    manualChatId: { type: 'string', description: 'Manual chat identifier' },
    channelId: { type: 'string', description: 'Channel identifier' },
    manualChannelId: { type: 'string', description: 'Manual channel identifier' },
    teamId: { type: 'string', description: 'Team identifier' },
    manualTeamId: { type: 'string', description: 'Manual team identifier' },
    content: {
      type: 'string',
      description: 'Message content. Mention users with <at>userName</at>',
    },
    reactionType: { type: 'string', description: 'Emoji reaction (e.g., ❤️, 👍, 😊)' },
    attachmentFiles: { type: 'json', description: 'Files to attach (UI upload)' },
    files: { type: 'json', description: 'Files to attach (UserFile array)' },
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
    deleted: { type: 'boolean', description: 'Whether message was successfully deleted' },
    messageId: { type: 'string', description: 'ID of the created/sent/deleted message' },
    createdTime: { type: 'string', description: 'Timestamp when message was created' },
    url: { type: 'string', description: 'Web URL to the message' },
    sender: { type: 'string', description: 'Message sender display name' },
    messageTimestamp: { type: 'string', description: 'Individual message timestamp' },
    messageType: {
      type: 'string',
      description: 'Type of message (message, systemEventMessage, etc.)',
    },
    reactionType: { type: 'string', description: 'Emoji reaction that was added/removed' },
    success: { type: 'boolean', description: 'Whether the operation was successful' },
    members: { type: 'json', description: 'Array of team/channel member objects' },
    memberCount: { type: 'number', description: 'Total number of members' },
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
