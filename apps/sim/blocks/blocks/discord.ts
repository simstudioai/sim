import { DiscordIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { DiscordResponse } from '@/tools/discord/types'

export const DiscordBlock: BlockConfig<DiscordResponse> = {
  type: 'discord',
  name: 'Discord',
  description: 'Interact with Discord',
  authMode: AuthMode.BotToken,
  longDescription:
    'Comprehensive Discord integration: messages, threads, channels, roles, members, invites, and webhooks.',
  category: 'tools',
  bgColor: '#5865F2',
  icon: DiscordIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Message', id: 'discord_send_message' },
        { label: 'Get Channel Messages', id: 'discord_get_messages' },
        { label: 'Get Server Information', id: 'discord_get_server' },
        { label: 'Get User Information', id: 'discord_get_user' },
        { label: 'Edit Message', id: 'discord_edit_message' },
        { label: 'Delete Message', id: 'discord_delete_message' },
        { label: 'Add Reaction', id: 'discord_add_reaction' },
        { label: 'Remove Reaction', id: 'discord_remove_reaction' },
        { label: 'Pin Message', id: 'discord_pin_message' },
        { label: 'Unpin Message', id: 'discord_unpin_message' },
        { label: 'Create Thread', id: 'discord_create_thread' },
        { label: 'Join Thread', id: 'discord_join_thread' },
        { label: 'Leave Thread', id: 'discord_leave_thread' },
        { label: 'Archive Thread', id: 'discord_archive_thread' },
        { label: 'Create Channel', id: 'discord_create_channel' },
        { label: 'Update Channel', id: 'discord_update_channel' },
        { label: 'Delete Channel', id: 'discord_delete_channel' },
        { label: 'Get Channel', id: 'discord_get_channel' },
        { label: 'Create Role', id: 'discord_create_role' },
        { label: 'Update Role', id: 'discord_update_role' },
        { label: 'Delete Role', id: 'discord_delete_role' },
        { label: 'Assign Role', id: 'discord_assign_role' },
        { label: 'Remove Role', id: 'discord_remove_role' },
        { label: 'Kick Member', id: 'discord_kick_member' },
        { label: 'Ban Member', id: 'discord_ban_member' },
        { label: 'Unban Member', id: 'discord_unban_member' },
        { label: 'Get Member', id: 'discord_get_member' },
        { label: 'Update Member', id: 'discord_update_member' },
        { label: 'Create Invite', id: 'discord_create_invite' },
        { label: 'Get Invite', id: 'discord_get_invite' },
        { label: 'Delete Invite', id: 'discord_delete_invite' },
        { label: 'Create Webhook', id: 'discord_create_webhook' },
        { label: 'Execute Webhook', id: 'discord_execute_webhook' },
        { label: 'Get Webhook', id: 'discord_get_webhook' },
        { label: 'Delete Webhook', id: 'discord_delete_webhook' },
      ],
      value: () => 'discord_send_message',
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      placeholder: 'Enter Discord bot token',
      password: true,
      required: true,
    },
    {
      id: 'serverId',
      title: 'Server ID',
      type: 'short-input',
      placeholder: 'Enter Discord server ID',
      required: true,
      provider: 'discord',
      serviceId: 'discord',
    },
    // Channel ID - for operations that need it
    {
      id: 'channelId',
      title: 'Channel ID',
      type: 'short-input',
      placeholder: 'Enter Discord channel ID',
      required: true,
      provider: 'discord',
      serviceId: 'discord',
      condition: {
        field: 'operation',
        value: [
          'discord_send_message',
          'discord_get_messages',
          'discord_edit_message',
          'discord_delete_message',
          'discord_add_reaction',
          'discord_remove_reaction',
          'discord_pin_message',
          'discord_unpin_message',
          'discord_create_thread',
          'discord_update_channel',
          'discord_delete_channel',
          'discord_get_channel',
          'discord_create_invite',
          'discord_create_webhook',
        ],
      },
    },
    // Message ID - for message operations
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Enter message ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'discord_edit_message',
          'discord_delete_message',
          'discord_add_reaction',
          'discord_remove_reaction',
          'discord_pin_message',
          'discord_unpin_message',
          'discord_create_thread',
        ],
      },
    },
    // Content - for send/edit message
    {
      id: 'content',
      title: 'Message Content',
      type: 'long-input',
      placeholder: 'Enter message content...',
      condition: {
        field: 'operation',
        value: ['discord_send_message', 'discord_edit_message', 'discord_execute_webhook'],
      },
    },
    // Emoji - for reaction operations
    {
      id: 'emoji',
      title: 'Emoji',
      type: 'short-input',
      placeholder: 'Enter emoji (e.g., 👍 or custom:123456789)',
      required: true,
      condition: {
        field: 'operation',
        value: ['discord_add_reaction', 'discord_remove_reaction'],
      },
    },
    // User ID - for user/member operations
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter Discord user ID',
      condition: {
        field: 'operation',
        value: [
          'discord_get_user',
          'discord_remove_reaction',
          'discord_assign_role',
          'discord_remove_role',
          'discord_kick_member',
          'discord_ban_member',
          'discord_unban_member',
          'discord_get_member',
          'discord_update_member',
        ],
      },
    },
    // Thread ID - for thread operations
    {
      id: 'threadId',
      title: 'Thread ID',
      type: 'short-input',
      placeholder: 'Enter thread ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['discord_join_thread', 'discord_leave_thread', 'discord_archive_thread'],
      },
    },
    // Thread/Channel Name
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Enter name',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'discord_create_thread',
          'discord_create_channel',
          'discord_create_role',
          'discord_create_webhook',
        ],
      },
    },
    // Name (optional for updates)
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Enter new name (optional)',
      condition: {
        field: 'operation',
        value: ['discord_update_channel', 'discord_update_role'],
      },
    },
    // Role ID
    {
      id: 'roleId',
      title: 'Role ID',
      type: 'short-input',
      placeholder: 'Enter role ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'discord_update_role',
          'discord_delete_role',
          'discord_assign_role',
          'discord_remove_role',
        ],
      },
    },
    // Webhook ID
    {
      id: 'webhookId',
      title: 'Webhook ID',
      type: 'short-input',
      placeholder: 'Enter webhook ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['discord_execute_webhook', 'discord_get_webhook', 'discord_delete_webhook'],
      },
    },
    // Webhook Token
    {
      id: 'webhookToken',
      title: 'Webhook Token',
      type: 'short-input',
      placeholder: 'Enter webhook token',
      required: true,
      condition: {
        field: 'operation',
        value: ['discord_execute_webhook'],
      },
    },
    // Invite Code
    {
      id: 'inviteCode',
      title: 'Invite Code',
      type: 'short-input',
      placeholder: 'Enter invite code',
      required: true,
      condition: {
        field: 'operation',
        value: ['discord_get_invite', 'discord_delete_invite'],
      },
    },
    // Archived (for thread operations)
    {
      id: 'archived',
      title: 'Archived',
      type: 'dropdown',
      options: [
        { label: 'Archive', id: 'true' },
        { label: 'Unarchive', id: 'false' },
      ],
      value: () => 'true',
      condition: {
        field: 'operation',
        value: ['discord_archive_thread'],
      },
    },
    // Topic (for channels)
    {
      id: 'topic',
      title: 'Topic',
      type: 'long-input',
      placeholder: 'Enter channel topic (optional)',
      condition: {
        field: 'operation',
        value: ['discord_create_channel', 'discord_update_channel'],
      },
    },
    // Color (for roles)
    {
      id: 'color',
      title: 'Color',
      type: 'short-input',
      placeholder: 'Enter color as integer (e.g., 16711680 for red)',
      condition: {
        field: 'operation',
        value: ['discord_create_role', 'discord_update_role'],
      },
    },
    // Nickname (for member update)
    {
      id: 'nick',
      title: 'Nickname',
      type: 'short-input',
      placeholder: 'Enter new nickname',
      condition: {
        field: 'operation',
        value: ['discord_update_member'],
      },
    },
    // Reason (for moderation actions)
    {
      id: 'reason',
      title: 'Reason',
      type: 'short-input',
      placeholder: 'Enter reason for this action',
      condition: {
        field: 'operation',
        value: ['discord_kick_member', 'discord_ban_member', 'discord_unban_member'],
      },
    },
    // Limit (for get messages)
    {
      id: 'limit',
      title: 'Message Limit',
      type: 'short-input',
      placeholder: 'Number of messages (default: 10, max: 100)',
      condition: { field: 'operation', value: 'discord_get_messages' },
    },
    // Auto Archive Duration (for threads)
    {
      id: 'autoArchiveDuration',
      title: 'Auto Archive Duration (minutes)',
      type: 'dropdown',
      options: [
        { label: '1 hour (60 minutes)', id: '60' },
        { label: '24 hours (1440 minutes)', id: '1440' },
        { label: '3 days (4320 minutes)', id: '4320' },
        { label: '1 week (10080 minutes)', id: '10080' },
      ],
      value: () => '1440',
      condition: {
        field: 'operation',
        value: ['discord_create_thread'],
      },
    },
    // Channel Type (for create_channel)
    {
      id: 'channelType',
      title: 'Channel Type',
      type: 'dropdown',
      options: [
        { label: 'Text Channel', id: '0' },
        { label: 'Voice Channel', id: '2' },
        { label: 'Announcement Channel', id: '5' },
        { label: 'Stage Channel', id: '13' },
        { label: 'Forum Channel', id: '15' },
      ],
      value: () => '0',
      condition: {
        field: 'operation',
        value: ['discord_create_channel'],
      },
    },
    // Parent ID (for create_channel)
    {
      id: 'parentId',
      title: 'Parent Category ID',
      type: 'short-input',
      placeholder: 'Enter parent category ID (optional)',
      condition: {
        field: 'operation',
        value: ['discord_create_channel'],
      },
    },
    // Hoist (for roles)
    {
      id: 'hoist',
      title: 'Display Separately',
      type: 'dropdown',
      options: [
        { label: 'Yes - Display role members separately', id: 'true' },
        { label: "No - Don't display separately", id: 'false' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: ['discord_create_role', 'discord_update_role'],
      },
    },
    // Mentionable (for roles)
    {
      id: 'mentionable',
      title: 'Mentionable',
      type: 'dropdown',
      options: [
        { label: 'Yes - Role can be mentioned', id: 'true' },
        { label: 'No - Role cannot be mentioned', id: 'false' },
      ],
      value: () => 'true',
      condition: {
        field: 'operation',
        value: ['discord_create_role', 'discord_update_role'],
      },
    },
    // Delete Message Days (for ban_member)
    {
      id: 'deleteMessageDays',
      title: 'Delete Message History',
      type: 'dropdown',
      options: [
        { label: "Don't delete any messages", id: '0' },
        { label: 'Delete messages from last 1 day', id: '1' },
        { label: 'Delete messages from last 7 days', id: '7' },
      ],
      value: () => '0',
      condition: {
        field: 'operation',
        value: ['discord_ban_member'],
      },
    },
    // Mute (for update_member)
    {
      id: 'mute',
      title: 'Server Mute',
      type: 'dropdown',
      options: [
        { label: 'Mute member', id: 'true' },
        { label: 'Unmute member', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: ['discord_update_member'],
      },
    },
    // Deaf (for update_member)
    {
      id: 'deaf',
      title: 'Server Deafen',
      type: 'dropdown',
      options: [
        { label: 'Deafen member', id: 'true' },
        { label: 'Undeafen member', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: ['discord_update_member'],
      },
    },
    // Max Age (for create_invite)
    {
      id: 'maxAge',
      title: 'Invite Expiration',
      type: 'dropdown',
      options: [
        { label: 'Never expire', id: '0' },
        { label: '30 minutes', id: '1800' },
        { label: '1 hour', id: '3600' },
        { label: '6 hours', id: '21600' },
        { label: '12 hours', id: '43200' },
        { label: '1 day', id: '86400' },
        { label: '7 days', id: '604800' },
      ],
      value: () => '86400',
      condition: {
        field: 'operation',
        value: ['discord_create_invite'],
      },
    },
    // Max Uses (for create_invite)
    {
      id: 'maxUses',
      title: 'Max Uses',
      type: 'short-input',
      placeholder: 'Maximum number of uses (0 = unlimited)',
      condition: {
        field: 'operation',
        value: ['discord_create_invite'],
      },
    },
    // Temporary (for create_invite)
    {
      id: 'temporary',
      title: 'Temporary Membership',
      type: 'dropdown',
      options: [
        { label: 'No - Grant permanent membership', id: 'false' },
        { label: 'Yes - Kick on disconnect if no role', id: 'true' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: ['discord_create_invite'],
      },
    },
    // Username (for execute_webhook)
    {
      id: 'username',
      title: 'Override Username',
      type: 'short-input',
      placeholder: 'Custom username to display (optional)',
      condition: {
        field: 'operation',
        value: ['discord_execute_webhook'],
      },
    },
    // File attachments
    {
      id: 'attachmentFiles',
      title: 'Attachments',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Upload files to attach',
      condition: { field: 'operation', value: 'discord_send_message' },
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
      condition: { field: 'operation', value: 'discord_send_message' },
      mode: 'advanced',
      required: false,
    },
  ],
  tools: {
    access: [
      'discord_send_message',
      'discord_get_messages',
      'discord_get_server',
      'discord_get_user',
      'discord_edit_message',
      'discord_delete_message',
      'discord_add_reaction',
      'discord_remove_reaction',
      'discord_pin_message',
      'discord_unpin_message',
      'discord_create_thread',
      'discord_join_thread',
      'discord_leave_thread',
      'discord_archive_thread',
      'discord_create_channel',
      'discord_update_channel',
      'discord_delete_channel',
      'discord_get_channel',
      'discord_create_role',
      'discord_update_role',
      'discord_delete_role',
      'discord_assign_role',
      'discord_remove_role',
      'discord_kick_member',
      'discord_ban_member',
      'discord_unban_member',
      'discord_get_member',
      'discord_update_member',
      'discord_create_invite',
      'discord_get_invite',
      'discord_delete_invite',
      'discord_create_webhook',
      'discord_execute_webhook',
      'discord_get_webhook',
      'discord_delete_webhook',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'discord_send_message'
      },
      params: (params) => {
        const commonParams: Record<string, any> = {
          botToken: params.botToken,
          serverId: params.serverId,
        }

        if (!params.botToken) throw new Error('Bot token is required')
        if (!params.serverId) throw new Error('Server ID is required')

        switch (params.operation) {
          case 'discord_send_message':
            return {
              ...commonParams,
              channelId: params.channelId,
              content: params.content,
              files: params.attachmentFiles || params.files,
            }
          case 'discord_get_messages':
            return {
              ...commonParams,
              channelId: params.channelId,
              limit: params.limit ? Math.min(Math.max(1, Number(params.limit)), 100) : 10,
            }
          case 'discord_get_server':
            return commonParams
          case 'discord_get_user':
            return { ...commonParams, userId: params.userId }
          case 'discord_edit_message':
            return {
              ...commonParams,
              channelId: params.channelId,
              messageId: params.messageId,
              content: params.content,
            }
          case 'discord_delete_message':
            return {
              ...commonParams,
              channelId: params.channelId,
              messageId: params.messageId,
            }
          case 'discord_add_reaction':
          case 'discord_remove_reaction':
            return {
              ...commonParams,
              channelId: params.channelId,
              messageId: params.messageId,
              emoji: params.emoji,
              ...(params.userId && { userId: params.userId }),
            }
          case 'discord_pin_message':
          case 'discord_unpin_message':
            return {
              ...commonParams,
              channelId: params.channelId,
              messageId: params.messageId,
            }
          case 'discord_create_thread':
            return {
              ...commonParams,
              channelId: params.channelId,
              name: params.name,
              ...(params.messageId && { messageId: params.messageId }),
              ...(params.autoArchiveDuration && {
                autoArchiveDuration: Number(params.autoArchiveDuration),
              }),
            }
          case 'discord_join_thread':
          case 'discord_leave_thread':
            return { ...commonParams, threadId: params.threadId }
          case 'discord_archive_thread':
            return {
              ...commonParams,
              threadId: params.threadId,
              archived: params.archived === 'true',
            }
          case 'discord_create_channel':
            return {
              ...commonParams,
              name: params.name,
              ...(params.topic && { topic: params.topic }),
              ...(params.channelType && { type: Number(params.channelType) }),
              ...(params.parentId && { parentId: params.parentId }),
            }
          case 'discord_update_channel':
            return {
              ...commonParams,
              channelId: params.channelId,
              ...(params.name && { name: params.name }),
              ...(params.topic !== undefined && { topic: params.topic }),
            }
          case 'discord_delete_channel':
          case 'discord_get_channel':
            return { ...commonParams, channelId: params.channelId }
          case 'discord_create_role':
            return {
              ...commonParams,
              name: params.name,
              ...(params.color && { color: Number(params.color) }),
              ...(params.hoist !== undefined && { hoist: params.hoist === 'true' }),
              ...(params.mentionable !== undefined && {
                mentionable: params.mentionable === 'true',
              }),
            }
          case 'discord_update_role':
            return {
              ...commonParams,
              roleId: params.roleId,
              ...(params.name && { name: params.name }),
              ...(params.color && { color: Number(params.color) }),
              ...(params.hoist !== undefined && { hoist: params.hoist === 'true' }),
              ...(params.mentionable !== undefined && {
                mentionable: params.mentionable === 'true',
              }),
            }
          case 'discord_delete_role':
            return { ...commonParams, roleId: params.roleId }
          case 'discord_assign_role':
          case 'discord_remove_role':
            return {
              ...commonParams,
              userId: params.userId,
              roleId: params.roleId,
            }
          case 'discord_kick_member':
          case 'discord_unban_member':
            return {
              ...commonParams,
              userId: params.userId,
              ...(params.reason && { reason: params.reason }),
            }
          case 'discord_ban_member':
            return {
              ...commonParams,
              userId: params.userId,
              ...(params.reason && { reason: params.reason }),
              ...(params.deleteMessageDays && {
                deleteMessageDays: Number(params.deleteMessageDays),
              }),
            }
          case 'discord_get_member':
            return { ...commonParams, userId: params.userId }
          case 'discord_update_member':
            return {
              ...commonParams,
              userId: params.userId,
              ...(params.nick !== undefined && { nick: params.nick }),
              ...(params.mute !== undefined && { mute: params.mute === 'true' }),
              ...(params.deaf !== undefined && { deaf: params.deaf === 'true' }),
            }
          case 'discord_create_invite':
            return {
              ...commonParams,
              channelId: params.channelId,
              ...(params.maxAge !== undefined && { maxAge: Number(params.maxAge) }),
              ...(params.maxUses !== undefined && { maxUses: Number(params.maxUses) }),
              ...(params.temporary !== undefined && { temporary: params.temporary === 'true' }),
            }
          case 'discord_get_invite':
          case 'discord_delete_invite':
            return { ...commonParams, inviteCode: params.inviteCode }
          case 'discord_create_webhook':
            return {
              ...commonParams,
              channelId: params.channelId,
              name: params.name,
            }
          case 'discord_execute_webhook':
            return {
              ...commonParams,
              webhookId: params.webhookId,
              webhookToken: params.webhookToken,
              content: params.content,
              ...(params.username && { username: params.username }),
            }
          case 'discord_get_webhook':
          case 'discord_delete_webhook':
            return { ...commonParams, webhookId: params.webhookId }
          default:
            return commonParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    botToken: { type: 'string', description: 'Discord bot token' },
    serverId: { type: 'string', description: 'Discord server identifier' },
    channelId: { type: 'string', description: 'Discord channel identifier' },
    messageId: { type: 'string', description: 'Discord message identifier' },
    threadId: { type: 'string', description: 'Discord thread identifier' },
    userId: { type: 'string', description: 'Discord user identifier' },
    roleId: { type: 'string', description: 'Discord role identifier' },
    webhookId: { type: 'string', description: 'Discord webhook identifier' },
    webhookToken: { type: 'string', description: 'Discord webhook token' },
    inviteCode: { type: 'string', description: 'Discord invite code' },
    content: { type: 'string', description: 'Message content' },
    emoji: { type: 'string', description: 'Emoji for reaction' },
    name: { type: 'string', description: 'Name for channel/role/thread/webhook' },
    topic: { type: 'string', description: 'Channel topic' },
    color: { type: 'string', description: 'Role color as integer' },
    nick: { type: 'string', description: 'Member nickname' },
    reason: { type: 'string', description: 'Reason for moderation action' },
    archived: { type: 'string', description: 'Archive status (true/false)' },
    attachmentFiles: { type: 'json', description: 'Files to attach (UI upload)' },
    files: { type: 'json', description: 'Files to attach (UserFile array)' },
    limit: { type: 'number', description: 'Message limit' },
    autoArchiveDuration: { type: 'number', description: 'Thread auto-archive duration in minutes' },
    channelType: { type: 'number', description: 'Discord channel type (0=text, 2=voice, etc.)' },
    parentId: { type: 'string', description: 'Parent category ID for channel' },
    hoist: { type: 'boolean', description: 'Whether to display role members separately' },
    mentionable: { type: 'boolean', description: 'Whether role can be mentioned' },
    deleteMessageDays: { type: 'number', description: 'Days of message history to delete on ban' },
    mute: { type: 'boolean', description: 'Server mute status' },
    deaf: { type: 'boolean', description: 'Server deafen status' },
    maxAge: { type: 'number', description: 'Invite expiration time in seconds' },
    maxUses: { type: 'number', description: 'Maximum number of invite uses' },
    temporary: { type: 'boolean', description: 'Whether invite grants temporary membership' },
    username: { type: 'string', description: 'Custom username for webhook execution' },
  },
  outputs: {
    message: { type: 'string', description: 'Status message' },
    data: { type: 'json', description: 'Response data' },
  },
}
