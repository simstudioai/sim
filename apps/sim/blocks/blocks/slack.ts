import { SlackIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { SlackResponse } from '@/tools/slack/types'
import { getTrigger } from '@/triggers'

export const SlackBlock: BlockConfig<SlackResponse> = {
  type: 'slack',
  name: 'Slack',
  description:
    'Send, update, delete messages, add reactions in Slack or trigger workflows from Slack events',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Slack into the workflow. Can send, update, and delete messages, create canvases, read messages, and add reactions. Requires Bot Token instead of OAuth in advanced mode. Can be used in trigger mode to trigger a workflow when a message is sent to a channel.',
  docsLink: 'https://docs.sim.ai/tools/slack',
  category: 'tools',
  bgColor: '#611f69',
  icon: SlackIcon,
  triggerAllowed: true,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Message', id: 'send' },
        { label: 'Create Canvas', id: 'canvas' },
        { label: 'Read Messages', id: 'read' },
        { label: 'List Channels', id: 'list_channels' },
        { label: 'List Channel Members', id: 'list_members' },
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User Info', id: 'get_user' },
        { label: 'Download File', id: 'download' },
        { label: 'Update Message', id: 'update' },
        { label: 'Delete Message', id: 'delete' },
        { label: 'Add Reaction', id: 'react' },
      ],
      value: () => 'send',
    },
    {
      id: 'authMethod',
      title: 'Authentication Method',
      type: 'dropdown',
      options: [
        { label: 'Sim Bot', id: 'oauth' },
        { label: 'Custom Bot', id: 'bot_token' },
      ],
      value: () => 'oauth',
      required: true,
    },
    {
      id: 'destinationType',
      title: 'Destination',
      type: 'dropdown',
      options: [
        { label: 'Channel', id: 'channel' },
        { label: 'Direct Message', id: 'dm' },
      ],
      value: () => 'channel',
      condition: {
        field: 'operation',
        value: ['send', 'read'],
      },
    },
    {
      id: 'credential',
      title: 'Slack Account',
      type: 'oauth-input',
      serviceId: 'slack',
      requiredScopes: [
        'channels:read',
        'channels:history',
        'groups:read',
        'groups:history',
        'chat:write',
        'chat:write.public',
        'im:write',
        'im:history',
        'im:read',
        'users:read',
        'files:write',
        'files:read',
        'canvases:write',
        'reactions:write',
      ],
      placeholder: 'Select Slack workspace',
      dependsOn: ['authMethod'],
      condition: {
        field: 'authMethod',
        value: 'oauth',
      },
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      placeholder: 'Enter your Slack bot token (xoxb-...)',
      password: true,
      dependsOn: ['authMethod'],
      condition: {
        field: 'authMethod',
        value: 'bot_token',
      },
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'channel-selector',
      canonicalParamId: 'channel',
      serviceId: 'slack',
      placeholder: 'Select Slack channel',
      mode: 'basic',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken'] },
      condition: {
        field: 'operation',
        value: ['list_channels', 'list_users', 'get_user'],
        not: true,
        and: {
          field: 'destinationType',
          value: 'dm',
          not: true,
        },
      },
    },
    {
      id: 'manualChannel',
      title: 'Channel ID',
      type: 'short-input',
      canonicalParamId: 'channel',
      placeholder: 'Enter Slack channel ID (e.g., C1234567890)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['list_channels', 'list_users', 'get_user'],
        not: true,
        and: {
          field: 'destinationType',
          value: 'dm',
          not: true,
        },
      },
    },
    {
      id: 'dmUserId',
      title: 'User',
      type: 'user-selector',
      canonicalParamId: 'dmUserId',
      serviceId: 'slack',
      placeholder: 'Select Slack user',
      mode: 'basic',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken'] },
      condition: {
        field: 'destinationType',
        value: 'dm',
      },
    },
    {
      id: 'manualDmUserId',
      title: 'User ID',
      type: 'short-input',
      canonicalParamId: 'dmUserId',
      placeholder: 'Enter Slack user ID (e.g., U1234567890)',
      mode: 'advanced',
      condition: {
        field: 'destinationType',
        value: 'dm',
      },
    },
    {
      id: 'text',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Enter your message (supports Slack mrkdwn)',
      condition: {
        field: 'operation',
        value: 'send',
      },
      required: true,
    },
    {
      id: 'threadTs',
      title: 'Thread Timestamp',
      type: 'short-input',
      placeholder: 'Reply to thread (e.g., 1405894322.002768)',
      condition: {
        field: 'operation',
        value: 'send',
      },
      required: false,
    },
    {
      id: 'attachmentFiles',
      title: 'Attachments',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Upload files to attach',
      condition: { field: 'operation', value: 'send' },
      mode: 'basic',
      multiple: true,
      required: false,
    },
    {
      id: 'files',
      title: 'File Attachments',
      type: 'short-input',
      canonicalParamId: 'files',
      placeholder: 'Reference files from previous blocks',
      condition: { field: 'operation', value: 'send' },
      mode: 'advanced',
      required: false,
    },
    // Canvas specific fields
    {
      id: 'title',
      title: 'Canvas Title',
      type: 'short-input',
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
      placeholder: '15',
      condition: {
        field: 'operation',
        value: 'read',
      },
    },
    // List Channels specific fields
    {
      id: 'includePrivate',
      title: 'Include Private Channels',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: {
        field: 'operation',
        value: 'list_channels',
      },
    },
    {
      id: 'channelLimit',
      title: 'Channel Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: 'list_channels',
      },
    },
    // List Members specific fields
    {
      id: 'memberLimit',
      title: 'Member Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: 'list_members',
      },
    },
    // List Users specific fields
    {
      id: 'includeDeleted',
      title: 'Include Deactivated Users',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: 'list_users',
      },
    },
    {
      id: 'userLimit',
      title: 'User Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: 'list_users',
      },
    },
    // Get User specific fields
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter Slack user ID (e.g., U1234567890)',
      condition: {
        field: 'operation',
        value: 'get_user',
      },
      required: true,
    },
    {
      id: 'oldest',
      title: 'Oldest Timestamp',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: {
        field: 'operation',
        value: 'read',
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
This timestamp is used to filter Slack messages - only messages after this timestamp will be returned.
Examples:
- "last hour" -> Calculate 1 hour ago from current time
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "beginning of this month" -> First day of current month at 00:00:00Z
- "30 minutes ago" -> Calculate 30 minutes before current time

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the cutoff date (e.g., "last hour", "yesterday", "last week")...',
        generationType: 'timestamp',
      },
    },
    // Download File specific fields
    {
      id: 'fileId',
      title: 'File ID',
      type: 'short-input',
      placeholder: 'Enter Slack file ID (e.g., F1234567890)',
      condition: {
        field: 'operation',
        value: 'download',
      },
      required: true,
    },
    {
      id: 'downloadFileName',
      title: 'File Name Override',
      type: 'short-input',
      canonicalParamId: 'fileName',
      placeholder: 'Optional: Override the filename',
      condition: {
        field: 'operation',
        value: 'download',
      },
    },
    // Update Message specific fields
    {
      id: 'updateTimestamp',
      title: 'Message Timestamp',
      type: 'short-input',
      placeholder: 'Message timestamp (e.g., 1405894322.002768)',
      condition: {
        field: 'operation',
        value: 'update',
      },
      required: true,
    },
    {
      id: 'updateText',
      title: 'New Message Text',
      type: 'long-input',
      placeholder: 'Enter new message text (supports Slack mrkdwn)',
      condition: {
        field: 'operation',
        value: 'update',
      },
      required: true,
    },
    // Delete Message specific fields
    {
      id: 'deleteTimestamp',
      title: 'Message Timestamp',
      type: 'short-input',
      placeholder: 'Message timestamp (e.g., 1405894322.002768)',
      condition: {
        field: 'operation',
        value: 'delete',
      },
      required: true,
    },
    // Add Reaction specific fields
    {
      id: 'reactionTimestamp',
      title: 'Message Timestamp',
      type: 'short-input',
      placeholder: 'Message timestamp (e.g., 1405894322.002768)',
      condition: {
        field: 'operation',
        value: 'react',
      },
      required: true,
    },
    {
      id: 'emojiName',
      title: 'Emoji Name',
      type: 'short-input',
      placeholder: 'Emoji name without colons (e.g., thumbsup, heart, eyes)',
      condition: {
        field: 'operation',
        value: 'react',
      },
      required: true,
    },
    ...getTrigger('slack_webhook').subBlocks,
  ],
  tools: {
    access: [
      'slack_message',
      'slack_canvas',
      'slack_message_reader',
      'slack_list_channels',
      'slack_list_members',
      'slack_list_users',
      'slack_get_user',
      'slack_download',
      'slack_update_message',
      'slack_delete_message',
      'slack_add_reaction',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send':
            return 'slack_message'
          case 'canvas':
            return 'slack_canvas'
          case 'read':
            return 'slack_message_reader'
          case 'list_channels':
            return 'slack_list_channels'
          case 'list_members':
            return 'slack_list_members'
          case 'list_users':
            return 'slack_list_users'
          case 'get_user':
            return 'slack_get_user'
          case 'download':
            return 'slack_download'
          case 'update':
            return 'slack_update_message'
          case 'delete':
            return 'slack_delete_message'
          case 'react':
            return 'slack_add_reaction'
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
          destinationType,
          channel,
          manualChannel,
          dmUserId,
          manualDmUserId,
          text,
          title,
          content,
          limit,
          oldest,
          attachmentFiles,
          files,
          threadTs,
          updateTimestamp,
          updateText,
          deleteTimestamp,
          reactionTimestamp,
          emojiName,
          includePrivate,
          channelLimit,
          memberLimit,
          includeDeleted,
          userLimit,
          userId,
          ...rest
        } = params

        const isDM = destinationType === 'dm'
        const effectiveChannel = (channel || manualChannel || '').trim()
        const effectiveUserId = (dmUserId || manualDmUserId || '').trim()

        const noChannelOperations = ['list_channels', 'list_users', 'get_user']
        const dmSupportedOperations = ['send', 'read']

        if (isDM && dmSupportedOperations.includes(operation)) {
          if (!effectiveUserId) {
            throw new Error('User is required for DM operations.')
          }
        } else if (!effectiveChannel && !noChannelOperations.includes(operation)) {
          throw new Error('Channel is required.')
        }

        const baseParams: Record<string, any> = {}

        if (isDM && dmSupportedOperations.includes(operation)) {
          baseParams.userId = effectiveUserId
        } else if (effectiveChannel) {
          baseParams.channel = effectiveChannel
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

        switch (operation) {
          case 'send': {
            if (!text || text.trim() === '') {
              throw new Error('Message text is required for send operation')
            }
            baseParams.text = text
            if (threadTs) {
              baseParams.thread_ts = threadTs
            }
            const fileParam = attachmentFiles || files
            if (fileParam) {
              baseParams.files = fileParam
            }
            break
          }

          case 'canvas':
            if (!title || !content) {
              throw new Error('Title and content are required for canvas operation')
            }
            baseParams.title = title
            baseParams.content = content
            break

          case 'read': {
            const parsedLimit = limit ? Number.parseInt(limit, 10) : 10
            if (Number.isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 15) {
              throw new Error('Message limit must be between 1 and 15')
            }
            baseParams.limit = parsedLimit
            if (oldest) {
              baseParams.oldest = oldest
            }
            break
          }

          case 'list_channels': {
            baseParams.includePrivate = includePrivate !== 'false'
            baseParams.excludeArchived = true
            baseParams.limit = channelLimit ? Number.parseInt(channelLimit, 10) : 100
            break
          }

          case 'list_members': {
            baseParams.limit = memberLimit ? Number.parseInt(memberLimit, 10) : 100
            break
          }

          case 'list_users': {
            baseParams.includeDeleted = includeDeleted === 'true'
            baseParams.limit = userLimit ? Number.parseInt(userLimit, 10) : 100
            break
          }

          case 'get_user':
            if (!userId) {
              throw new Error('User ID is required for get user operation')
            }
            baseParams.userId = userId
            break

          case 'download': {
            const fileId = (rest as any).fileId
            const downloadFileName = (rest as any).downloadFileName
            if (!fileId) {
              throw new Error('File ID is required for download operation')
            }
            baseParams.fileId = fileId
            if (downloadFileName) {
              baseParams.fileName = downloadFileName
            }
            break
          }

          case 'update':
            if (!updateTimestamp || !updateText) {
              throw new Error('Timestamp and text are required for update operation')
            }
            baseParams.timestamp = updateTimestamp
            baseParams.text = updateText
            break

          case 'delete':
            if (!deleteTimestamp) {
              throw new Error('Timestamp is required for delete operation')
            }
            baseParams.timestamp = deleteTimestamp
            break

          case 'react':
            if (!reactionTimestamp || !emojiName) {
              throw new Error('Timestamp and emoji name are required for reaction operation')
            }
            baseParams.timestamp = reactionTimestamp
            baseParams.name = emojiName
            break
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    authMethod: { type: 'string', description: 'Authentication method' },
    destinationType: { type: 'string', description: 'Destination type (channel or dm)' },
    credential: { type: 'string', description: 'Slack access token' },
    botToken: { type: 'string', description: 'Bot token' },
    channel: { type: 'string', description: 'Channel identifier' },
    manualChannel: { type: 'string', description: 'Manual channel identifier' },
    dmUserId: { type: 'string', description: 'User ID for DM recipient (selector)' },
    manualDmUserId: { type: 'string', description: 'User ID for DM recipient (manual input)' },
    text: { type: 'string', description: 'Message text' },
    attachmentFiles: { type: 'json', description: 'Files to attach (UI upload)' },
    files: { type: 'array', description: 'Files to attach (UserFile array)' },
    title: { type: 'string', description: 'Canvas title' },
    content: { type: 'string', description: 'Canvas content' },
    limit: { type: 'string', description: 'Message limit' },
    oldest: { type: 'string', description: 'Oldest timestamp' },
    fileId: { type: 'string', description: 'File ID to download' },
    downloadFileName: { type: 'string', description: 'File name override for download' },
    // Update/Delete/React operation inputs
    updateTimestamp: { type: 'string', description: 'Message timestamp for update' },
    updateText: { type: 'string', description: 'New text for update' },
    deleteTimestamp: { type: 'string', description: 'Message timestamp for delete' },
    reactionTimestamp: { type: 'string', description: 'Message timestamp for reaction' },
    emojiName: { type: 'string', description: 'Emoji name for reaction' },
    timestamp: { type: 'string', description: 'Message timestamp' },
    name: { type: 'string', description: 'Emoji name' },
    threadTs: { type: 'string', description: 'Thread timestamp' },
    thread_ts: { type: 'string', description: 'Thread timestamp for reply' },
    // List Channels inputs
    includePrivate: { type: 'string', description: 'Include private channels (true/false)' },
    channelLimit: { type: 'string', description: 'Maximum number of channels to return' },
    // List Members inputs
    memberLimit: { type: 'string', description: 'Maximum number of members to return' },
    // List Users inputs
    includeDeleted: { type: 'string', description: 'Include deactivated users (true/false)' },
    userLimit: { type: 'string', description: 'Maximum number of users to return' },
    // Get User inputs
    userId: { type: 'string', description: 'User ID to look up' },
  },
  outputs: {
    // slack_message outputs (send operation)
    message: {
      type: 'json',
      description:
        'Complete message object with all properties: ts, text, user, channel, reactions, threads, files, attachments, blocks, stars, pins, and edit history',
    },
    // Legacy properties for send operation (backward compatibility)
    ts: { type: 'string', description: 'Message timestamp returned by Slack API' },
    channel: { type: 'string', description: 'Channel identifier where message was sent' },
    fileCount: {
      type: 'number',
      description: 'Number of files uploaded (when files are attached)',
    },

    // slack_canvas outputs
    canvas_id: { type: 'string', description: 'Canvas identifier for created canvases' },
    title: { type: 'string', description: 'Canvas title' },

    // slack_message_reader outputs (read operation)
    messages: {
      type: 'json',
      description:
        'Array of message objects with comprehensive properties: text, user, timestamp, reactions, threads, files, attachments, blocks, stars, pins, and edit history',
    },

    // slack_list_channels outputs (list_channels operation)
    channels: {
      type: 'json',
      description:
        'Array of channel objects with properties: id, name, is_private, is_archived, is_member, num_members, topic, purpose, created, creator',
    },
    count: {
      type: 'number',
      description: 'Total number of items returned (channels, members, or users)',
    },

    // slack_list_members outputs (list_members operation)
    members: {
      type: 'json',
      description: 'Array of user IDs who are members of the channel',
    },

    // slack_list_users outputs (list_users operation)
    users: {
      type: 'json',
      description:
        'Array of user objects with properties: id, name, real_name, display_name, is_bot, is_admin, deleted, timezone, avatar, status_text, status_emoji',
    },

    // slack_get_user outputs (get_user operation)
    user: {
      type: 'json',
      description:
        'Detailed user object with properties: id, name, real_name, display_name, first_name, last_name, title, is_bot, is_admin, deleted, timezone, avatars, status',
    },

    // slack_download outputs
    file: {
      type: 'json',
      description: 'Downloaded file stored in execution files',
    },

    // slack_update_message outputs (update operation)
    content: { type: 'string', description: 'Success message for update operation' },
    metadata: {
      type: 'json',
      description: 'Updated message metadata (legacy, use message object instead)',
    },

    // Trigger outputs (when used as webhook trigger)
    event_type: { type: 'string', description: 'Type of Slack event that triggered the workflow' },
    channel_name: { type: 'string', description: 'Human-readable channel name' },
    user_name: { type: 'string', description: 'Username who triggered the event' },
    timestamp: { type: 'string', description: 'Message timestamp from the triggering event' },
    thread_ts: {
      type: 'string',
      description: 'Parent thread timestamp (if message is in a thread)',
    },
    team_id: { type: 'string', description: 'Slack workspace/team ID' },
    event_id: { type: 'string', description: 'Unique event identifier for the trigger' },
  },
  // New: Trigger capabilities
  triggers: {
    enabled: true,
    available: ['slack_webhook'],
  },
}
