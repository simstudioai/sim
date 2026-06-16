import { MicrosoftTeamsIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { MicrosoftTeamsResponse } from '@/tools/microsoft_teams/types'
import { getTrigger } from '@/triggers'

export const MicrosoftTeamsBlock: BlockConfig<MicrosoftTeamsResponse> = {
  type: 'microsoft_teams',
  name: 'Microsoft Teams',
  description: 'Manage messages, reactions, and members in Teams',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Microsoft Teams into the workflow. Read, write, update, and delete chat and channel messages. Reply to messages, add reactions, and list team/channel members. Can be used in trigger mode to trigger a workflow when a message is sent to a chat or channel. To mention users in messages, wrap their name in `<at>` tags: `<at>userName</at>`',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_teams',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  triggerAllowed: true,
  bgColor: '#FFFFFF',
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
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'microsoft-teams',
      requiredScopes: getScopesForService('microsoft-teams'),
      placeholder: 'Select Microsoft account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Microsoft Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'teamSelector',
      title: 'Select Team',
      type: 'file-selector',
      canonicalParamId: 'teamId',
      serviceId: 'microsoft-teams',
      selectorKey: 'microsoft.teams',
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
      required: true,
    },
    {
      id: 'manualTeamId',
      title: 'Team ID',
      type: 'short-input',
      canonicalParamId: 'teamId',
      placeholder: 'Enter team ID',
      dependsOn: ['credential'],
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
      required: true,
    },
    {
      id: 'chatSelector',
      title: 'Select Chat',
      type: 'file-selector',
      canonicalParamId: 'chatId',
      serviceId: 'microsoft-teams',
      selectorKey: 'microsoft.chats',
      requiredScopes: [],
      placeholder: 'Select a chat',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['read_chat', 'write_chat', 'update_chat_message', 'delete_chat_message'],
      },
      required: true,
    },
    {
      id: 'manualChatId',
      title: 'Chat ID',
      type: 'short-input',
      canonicalParamId: 'chatId',
      placeholder: 'Enter chat ID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['read_chat', 'write_chat', 'update_chat_message', 'delete_chat_message'],
      },
      required: true,
    },
    {
      id: 'channelSelector',
      title: 'Select Channel',
      type: 'file-selector',
      canonicalParamId: 'channelId',
      serviceId: 'microsoft-teams',
      selectorKey: 'microsoft.channels',
      requiredScopes: [],
      placeholder: 'Select a channel',
      dependsOn: ['credential', 'teamSelector'],
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
      required: true,
    },
    {
      id: 'manualChannelId',
      title: 'Channel ID',
      type: 'short-input',
      canonicalParamId: 'channelId',
      placeholder: 'Enter channel ID',
      dependsOn: ['credential', 'teamId'],
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
      required: true,
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
    {
      id: 'includeAttachments',
      title: 'Include Attachments',
      type: 'switch',
      condition: { field: 'operation', value: ['read_chat', 'read_channel'] },
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
      id: 'fileReferences',
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
          oauthCredential,
          operation,
          teamId, // Canonical param from teamSelector (basic) or manualTeamId (advanced)
          chatId, // Canonical param from chatSelector (basic) or manualChatId (advanced)
          channelId, // Canonical param from channelSelector (basic) or manualChannelId (advanced)
          files, // Canonical param from attachmentFiles (basic) or fileReferences (advanced)
          messageId,
          reactionType,
          includeAttachments,
          ...rest
        } = params

        const effectiveTeamId = teamId ? String(teamId).trim() : ''
        const effectiveChatId = chatId ? String(chatId).trim() : ''
        const effectiveChannelId = channelId ? String(channelId).trim() : ''

        const baseParams: Record<string, any> = {
          ...rest,
          oauthCredential,
        }

        if ((operation === 'read_chat' || operation === 'read_channel') && includeAttachments) {
          baseParams.includeAttachments = true
        }

        // Add files if provided (canonical param from attachmentFiles or fileReferences)
        if (operation === 'write_chat' || operation === 'write_channel') {
          const normalizedFiles = normalizeFileInput(files)
          if (normalizedFiles) {
            baseParams.files = normalizedFiles
          }
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
          return { ...baseParams, teamId: effectiveTeamId, channelId: effectiveChannelId }
        }

        // Team member operations
        if (operation === 'list_team_members') {
          return { ...baseParams, teamId: effectiveTeamId }
        }

        // Channel member operations
        if (operation === 'list_channel_members') {
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
    oauthCredential: { type: 'string', description: 'Microsoft Teams access token' },
    messageId: {
      type: 'string',
      description: 'Message identifier for update/delete/reply/reaction operations',
    },
    // Canonical params (used by params function)
    teamId: { type: 'string', description: 'Team identifier' },
    chatId: { type: 'string', description: 'Chat identifier' },
    channelId: { type: 'string', description: 'Channel identifier' },
    files: { type: 'array', description: 'Files to attach' },
    content: {
      type: 'string',
      description: 'Message content. Mention users with <at>userName</at>',
    },
    reactionType: { type: 'string', description: 'Emoji reaction (e.g., ❤️, 👍, 😊)' },
    includeAttachments: {
      type: 'boolean',
      description: 'Download and include message attachments',
    },
  },
  outputs: {
    content: { type: 'string', description: 'Formatted message content from chat/channel' },
    metadata: { type: 'json', description: 'Message metadata with full details' },
    messageCount: { type: 'number', description: 'Number of messages retrieved' },
    messages: { type: 'json', description: 'Array of message objects' },
    totalAttachments: { type: 'number', description: 'Total number of attachments' },
    attachmentTypes: { type: 'json', description: 'Array of attachment content types' },
    attachments: { type: 'file[]', description: 'Downloaded message attachments' },
    files: { type: 'file[]', description: 'Files attached to the message' },
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

export const MicrosoftTeamsBlockMeta = {
  tags: ['messaging', 'microsoft-365'],
  url: 'https://www.microsoft.com/microsoft-teams/group-chat-software',
  templates: [
    {
      icon: MicrosoftTeamsIcon,
      title: 'Microsoft Teams daily brief',
      prompt:
        'Build a scheduled workflow that pulls updates from your project tools — GitHub commits, Jira ticket status changes, and calendar events — and posts a formatted daily brief to your Microsoft Teams channel each morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting', 'enterprise'],
      alsoIntegrations: ['github', 'jira'],
    },
    {
      icon: MicrosoftTeamsIcon,
      title: 'Teams incident war room',
      prompt:
        'Build a workflow triggered by a PagerDuty incident that creates a Microsoft Teams war-room channel, invites responders, posts the incident summary, and keeps the channel name in sync with incident state.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: MicrosoftTeamsIcon,
      title: 'Teams sales-deal channel',
      prompt:
        'Create a workflow that listens for new Salesforce opportunities above a threshold, creates a Microsoft Teams channel for the deal, invites the account team, and pins the opportunity link.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enterprise'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: MicrosoftTeamsIcon,
      title: 'Teams approval router',
      prompt:
        'Build a workflow that posts approval requests with quick-action buttons in Microsoft Teams, captures the decision, writes it back to the source record, and notifies the requester.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
    },
    {
      icon: MicrosoftTeamsIcon,
      title: 'Teams weekly metrics digest',
      prompt:
        'Create a scheduled weekly workflow that aggregates key business metrics from Stripe and HubSpot, formats them into a polished Microsoft Teams adaptive card, and posts to the leadership channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'enterprise'],
      alsoIntegrations: ['stripe', 'hubspot'],
    },
    {
      icon: MicrosoftTeamsIcon,
      title: 'Teams onboarding bot',
      prompt:
        'Build a Microsoft Teams bot that greets new hires when added to the org, walks them through onboarding tasks with progress checkboxes, and writes completion status to an HR table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
    },
    {
      icon: MicrosoftTeamsIcon,
      title: 'Teams ticket-bridge for Zendesk',
      prompt:
        'Create a workflow that mirrors high-priority Zendesk tickets into Microsoft Teams channels, keeps replies synced both ways, and closes the Teams thread when the ticket is resolved.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'enterprise'],
      alsoIntegrations: ['zendesk'],
    },
  ],
  skills: [
    {
      name: 'post-channel-announcement',
      description: 'Write a formatted message to a specific Microsoft Teams channel.',
      content:
        '# Post Channel Announcement\n\nSend an announcement or update to a Microsoft Teams channel.\n\n## Steps\n1. Identify the team and channel to post to, selecting the channel id.\n2. Compose the message body, using clear headings and bullets so it reads well in Teams.\n3. Run Write Channel Message with the channel id and the formatted content.\n4. If a thread already exists for the topic, use Reply to Channel Message instead to keep context together.\n\n## Output\nConfirm the posted message id and channel. Quote the first line of what was posted.',
    },
    {
      name: 'summarize-channel-activity',
      description:
        'Read recent Microsoft Teams channel messages and produce a concise digest of decisions and action items.',
      content:
        '# Summarize Channel Activity\n\nTurn a busy Microsoft Teams channel into a short readable digest.\n\n## Steps\n1. Run Read Channel Messages for the target channel.\n2. Group messages by topic or thread and drop noise such as greetings and reactions.\n3. Extract decisions made, open questions, and any explicit action items with owners.\n4. Optionally post the digest back to the channel as a new message.\n\n## Output\nThree short sections: Decisions, Open Questions, Action Items. Each item one line with the person responsible when known.',
    },
    {
      name: 'acknowledge-with-reaction',
      description: 'React to a specific Microsoft Teams message to acknowledge it.',
      content:
        '# Acknowledge with Reaction\n\nAdd or remove an emoji reaction on a Microsoft Teams message.\n\n## Steps\n1. Locate the message using Get Message or the known message id and channel/chat id.\n2. Run Add Reaction with the desired reactionType to acknowledge or signal status.\n3. Use Remove Reaction when the acknowledgment should be cleared.\n\n## Output\nConfirm the reaction applied and on which message. Keep the response to one line.',
    },
    {
      name: 'list-team-members',
      description: 'List the members of a Microsoft Teams team or channel for routing or auditing.',
      content:
        '# List Team Members\n\nRetrieve who belongs to a Microsoft Teams team or channel.\n\n## Steps\n1. Decide whether you need team-wide membership or a single channel and pick List Team Members or List Channel Members.\n2. Run the operation with the team id (and channel id when needed).\n3. Normalize the result into a clean roster of names and roles.\n\n## Output\nA roster list with display name and role. Note the total count at the top.',
    },
  ],
} as const satisfies BlockMeta
