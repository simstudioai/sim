import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import {
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'

interface SlackWorkflowField {
  id: string
  param: string
  title: string
  type: 'string' | 'boolean' | 'number' | 'json'
  required: boolean
  enum?: string[]
  options?: SubBlockConfig['options']
  dependsOn?: string[]
  default?: string
  allowEmpty?: boolean
  basic?: boolean
  min?: number
  max?: number
  description?: string
}
interface SlackWorkflowOperation {
  id: string
  label: string
  tool: string
  auth: 'bot' | 'any'
  fields: SlackWorkflowField[]
}

export const SLACK_WORKFLOW_OPERATIONS: readonly SlackWorkflowOperation[] = [
  {
    id: 'revoke_list_access',
    label: 'Revoke List Access',
    tool: 'slack_lists_access_delete',
    auth: 'bot',
    fields: [
      {
        id: 'slack_revoke_list_access_list_id',
        param: 'list_id',
        title: 'List ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_revoke_list_access_user_ids',
        basic: true,
        param: 'user_ids',
        title: 'User IDs',
        type: 'json',
        required: false,
      },
      {
        id: 'slack_revoke_list_access_channel_ids',
        basic: true,
        param: 'channel_ids',
        title: 'Channel IDs',
        type: 'json',
        required: false,
      },
    ],
  },
  {
    id: 'start_list_export',
    label: 'Start List Export',
    tool: 'slack_lists_download_start',
    auth: 'bot',
    fields: [
      {
        id: 'slack_start_list_export_list_id',
        param: 'list_id',
        title: 'List ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_start_list_export_format',
        param: 'format',
        title: 'Export Format',
        type: 'string',
        required: false,
        enum: ['csv', 'json'],
        default: 'csv',
      },
      {
        id: 'slack_start_list_export_include_threads',
        param: 'include_threads',
        title: 'Include Threads',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_start_list_export_include_attachments',
        param: 'include_attachments',
        title: 'Include Attachments',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_start_list_export_include_archived',
        param: 'include_archived',
        title: 'Include Archived Rows',
        type: 'boolean',
        required: false,
      },
    ],
  },
  {
    id: 'get_list_export',
    label: 'Get List Export',
    tool: 'slack_lists_download_get',
    auth: 'bot',
    fields: [
      {
        id: 'slack_get_list_export_list_id',
        param: 'list_id',
        title: 'List ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_get_list_export_job_id',
        param: 'job_id',
        title: 'Export Job ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_get_list_export_format',
        param: 'format',
        title: 'Export Format',
        type: 'string',
        required: false,
        enum: ['csv', 'json'],
        default: 'csv',
      },
      {
        id: 'slack_get_list_export_include_threads',
        param: 'include_threads',
        title: 'Include Threads',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_get_list_export_include_attachments',
        param: 'include_attachments',
        title: 'Include Attachments',
        type: 'boolean',
        required: false,
      },
    ],
  },
  {
    id: 'delete_list_items',
    label: 'Delete List Items',
    tool: 'slack_lists_items_delete_multiple',
    auth: 'bot',
    fields: [
      {
        id: 'slack_delete_list_items_list_id',
        param: 'list_id',
        title: 'List ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_delete_list_items_ids',
        param: 'ids',
        title: 'Row IDs',
        type: 'json',
        required: true,
      },
    ],
  },
  {
    id: 'share_canvas',
    label: 'Share Canvas',
    tool: 'slack_share_canvas',
    auth: 'any',
    fields: [
      {
        id: 'slack_share_canvas_canvas_id',
        param: 'canvas_id',
        title: 'Canvas ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_share_canvas_access_level',
        param: 'access_level',
        title: 'Access Level',
        type: 'string',
        required: true,
        enum: ['read', 'write', 'owner'],
        dependsOn: ['slack_share_canvas_channel_ids'],
        options: ({ values } = { values: {} }) => {
          const channels = values.slack_share_canvas_channel_ids
          const hasChannels = Array.isArray(channels)
            ? channels.length > 0
            : typeof channels === 'string' && channels.trim() !== '' && channels.trim() !== '[]'
          return [
            { id: 'read', label: 'Can view' },
            { id: 'write', label: 'Can edit' },
            ...(!hasChannels ? [{ id: 'owner', label: 'Owner (users only)' }] : []),
          ]
        },
        default: 'read',
      },
      {
        id: 'slack_share_canvas_user_ids',
        basic: true,
        param: 'user_ids',
        title: 'User IDs',
        type: 'json',
        required: false,
      },
      {
        id: 'slack_share_canvas_channel_ids',
        basic: true,
        param: 'channel_ids',
        title: 'Channel IDs',
        type: 'json',
        required: false,
      },
    ],
  },
  {
    id: 'revoke_canvas_access',
    label: 'Revoke Canvas Access',
    tool: 'slack_revoke_canvas_access',
    auth: 'any',
    fields: [
      {
        id: 'slack_revoke_canvas_access_canvas_id',
        param: 'canvas_id',
        title: 'Canvas ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_revoke_canvas_access_user_ids',
        basic: true,
        param: 'user_ids',
        title: 'User IDs',
        type: 'json',
        required: false,
      },
      {
        id: 'slack_revoke_canvas_access_channel_ids',
        basic: true,
        param: 'channel_ids',
        title: 'Channel IDs',
        type: 'json',
        required: false,
      },
    ],
  },
  {
    id: 'join_conversation',
    label: 'Join Conversation',
    tool: 'slack_join_conversation',
    auth: 'bot',
    fields: [
      {
        id: 'slack_join_conversation_channel',
        param: 'channel',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'leave_conversation',
    label: 'Leave Conversation',
    tool: 'slack_leave_conversation',
    auth: 'any',
    fields: [
      {
        id: 'slack_leave_conversation_channel',
        param: 'channel',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'kick_conversation',
    label: 'Remove User from Conversation',
    tool: 'slack_kick_conversation',
    auth: 'any',
    fields: [
      {
        id: 'slack_kick_conversation_channel',
        param: 'channel',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_kick_conversation_user',
        param: 'user',
        title: 'User ID',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'unarchive_conversation',
    label: 'Unarchive Conversation',
    tool: 'slack_unarchive_conversation',
    auth: 'any',
    fields: [
      {
        id: 'slack_unarchive_conversation_channel',
        param: 'channel',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'close_conversation',
    label: 'Close Conversation',
    tool: 'slack_close_conversation',
    auth: 'any',
    fields: [
      {
        id: 'slack_close_conversation_channel',
        param: 'channel',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'mark_conversation_read',
    label: 'Mark Conversation Read',
    tool: 'slack_mark_conversation_read',
    auth: 'any',
    fields: [
      {
        id: 'slack_mark_conversation_read_channel',
        param: 'channel',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_mark_conversation_read_ts',
        param: 'ts',
        title: 'Read Through Timestamp',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'open_conversation',
    label: 'Open Conversation',
    tool: 'slack_open_conversation',
    auth: 'any',
    fields: [
      {
        id: 'slack_open_conversation_users',
        basic: true,
        param: 'users',
        title: 'User IDs',
        type: 'json',
        required: false,
      },
      {
        id: 'slack_open_conversation_channel',
        basic: true,
        param: 'channel',
        title: 'Conversation ID',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_open_conversation_prevent_creation',
        param: 'prevent_creation',
        title: 'Only Resume Existing Conversation',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_open_conversation_return_im',
        param: 'return_im',
        title: 'Include Conversation Details',
        type: 'boolean',
        required: false,
      },
    ],
  },
  {
    id: 'lookup_user_by_email',
    label: 'Find User by Email',
    tool: 'slack_lookup_user_by_email',
    auth: 'bot',
    fields: [
      {
        id: 'slack_lookup_user_by_email_email',
        param: 'email',
        title: 'Email',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'list_user_conversations',
    label: 'List User Conversations',
    tool: 'slack_list_user_conversations',
    auth: 'any',
    fields: [
      {
        id: 'slack_list_user_conversations_user',
        param: 'user',
        title: 'User ID',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_list_user_conversations_types',
        param: 'types',
        title: 'Conversation Types',
        type: 'string',
        required: false,
        description: 'Comma-separated public_channel, private_channel, mpim, im.',
      },
      {
        id: 'slack_list_user_conversations_exclude_archived',
        param: 'exclude_archived',
        title: 'Exclude Archived',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_list_user_conversations_exclude_muted',
        param: 'exclude_muted',
        title: 'Exclude Muted',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_list_user_conversations_cursor',
        param: 'cursor',
        title: 'Cursor',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_list_user_conversations_limit',
        param: 'limit',
        title: 'Page Size',
        type: 'number',
        required: false,
        min: 1,
        max: 999,
      },
      {
        id: 'slack_list_user_conversations_team_id',
        param: 'team_id',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'get_user_profile',
    label: 'Get User Profile',
    tool: 'slack_get_user_profile',
    auth: 'bot',
    fields: [
      {
        id: 'slack_get_user_profile_user',
        param: 'user',
        title: 'User ID',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_get_user_profile_include_labels',
        param: 'include_labels',
        title: 'Include Custom Field Labels',
        type: 'boolean',
        required: false,
      },
    ],
  },
  {
    id: 'set_user_presence',
    label: 'Set Bot Presence',
    tool: 'slack_set_user_presence',
    auth: 'bot',
    fields: [
      {
        id: 'slack_set_user_presence_presence',
        param: 'presence',
        title: 'Presence',
        type: 'string',
        required: true,
        enum: ['auto', 'away'],
        default: 'auto',
      },
    ],
  },
  {
    id: 'get_file_info',
    label: 'Get File Info',
    tool: 'slack_get_file_info',
    auth: 'any',
    fields: [
      {
        id: 'slack_get_file_info_file',
        param: 'file',
        title: 'File ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_get_file_info_cursor',
        param: 'cursor',
        title: 'Cursor',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_get_file_info_limit',
        param: 'limit',
        title: 'Page Size',
        type: 'number',
        required: false,
        min: 1,
        max: 999,
      },
    ],
  },
  {
    id: 'list_files',
    label: 'List Files',
    tool: 'slack_list_files',
    auth: 'any',
    fields: [
      {
        id: 'slack_list_files_channel',
        param: 'channel',
        title: 'Channel ID',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_list_files_user',
        param: 'user',
        title: 'User ID',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_list_files_types',
        param: 'types',
        title: 'File Types',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_list_files_ts_from',
        param: 'ts_from',
        title: 'From Timestamp',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_list_files_ts_to',
        param: 'ts_to',
        title: 'To Timestamp',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_list_files_page',
        param: 'page',
        title: 'Page',
        type: 'number',
        required: false,
        min: 1,
      },
      {
        id: 'slack_list_files_count',
        param: 'count',
        title: 'Page Size',
        type: 'number',
        required: false,
        min: 1,
        max: 100,
      },
      {
        id: 'slack_list_files_show_files_hidden_by_limit',
        param: 'show_files_hidden_by_limit',
        title: 'Include Files Hidden by Plan Limit',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_list_files_team_id',
        param: 'team_id',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'delete_file',
    label: 'Delete File',
    tool: 'slack_delete_file',
    auth: 'any',
    fields: [
      {
        id: 'slack_delete_file_file',
        param: 'file',
        title: 'File ID',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'get_reactions',
    label: 'Get Reactions',
    tool: 'slack_get_reactions',
    auth: 'any',
    fields: [
      {
        id: 'slack_get_reactions_channel',
        basic: true,
        param: 'channel',
        title: 'Channel ID',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_get_reactions_timestamp',
        basic: true,
        param: 'timestamp',
        title: 'Message Timestamp',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_get_reactions_file',
        basic: true,
        param: 'file',
        title: 'File ID',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_get_reactions_file_comment',
        basic: true,
        param: 'file_comment',
        title: 'File Comment ID',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_get_reactions_full',
        param: 'full',
        title: 'Include All Reacting Users',
        type: 'boolean',
        required: false,
      },
    ],
  },
  {
    id: 'list_reactions',
    label: 'List Reactions',
    tool: 'slack_list_reactions',
    auth: 'any',
    fields: [
      {
        id: 'slack_list_reactions_user',
        param: 'user',
        title: 'User ID',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_list_reactions_full',
        param: 'full',
        title: 'Include All Reacting Users',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_list_reactions_cursor',
        param: 'cursor',
        title: 'Cursor',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_list_reactions_limit',
        param: 'limit',
        title: 'Page Size',
        type: 'number',
        required: false,
        min: 1,
        max: 999,
      },
      {
        id: 'slack_list_reactions_team_id',
        param: 'team_id',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'pin_message',
    label: 'Pin Message',
    tool: 'slack_pin_message',
    auth: 'bot',
    fields: [
      {
        id: 'slack_pin_message_channel',
        param: 'channel',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_pin_message_timestamp',
        param: 'timestamp',
        title: 'Message Timestamp',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'unpin_message',
    label: 'Unpin Message',
    tool: 'slack_unpin_message',
    auth: 'bot',
    fields: [
      {
        id: 'slack_unpin_message_channel',
        param: 'channel',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_unpin_message_timestamp',
        param: 'timestamp',
        title: 'Message Timestamp',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'list_pins',
    label: 'List Pins',
    tool: 'slack_list_pins',
    auth: 'bot',
    fields: [
      {
        id: 'slack_list_pins_channel',
        param: 'channel',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'add_bookmark',
    label: 'Add Bookmark',
    tool: 'slack_add_bookmark',
    auth: 'bot',
    fields: [
      {
        id: 'slack_add_bookmark_channel_id',
        param: 'channel_id',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_add_bookmark_title',
        param: 'title',
        title: 'Title',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_add_bookmark_link',
        param: 'link',
        title: 'Link URL',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_add_bookmark_emoji',
        param: 'emoji',
        title: 'Emoji',
        type: 'string',
        required: false,
        allowEmpty: true,
      },
      {
        id: 'slack_add_bookmark_parent_id',
        param: 'parent_id',
        title: 'Parent Bookmark ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'edit_bookmark',
    label: 'Edit Bookmark',
    tool: 'slack_edit_bookmark',
    auth: 'bot',
    fields: [
      {
        id: 'slack_edit_bookmark_channel_id',
        param: 'channel_id',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_edit_bookmark_bookmark_id',
        param: 'bookmark_id',
        title: 'Bookmark ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_edit_bookmark_title',
        basic: true,
        param: 'title',
        title: 'Title',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_edit_bookmark_link',
        basic: true,
        param: 'link',
        title: 'Link URL',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_edit_bookmark_emoji',
        basic: true,
        param: 'emoji',
        title: 'Emoji',
        type: 'string',
        required: false,
        allowEmpty: true,
      },
    ],
  },
  {
    id: 'list_bookmarks',
    label: 'List Bookmarks',
    tool: 'slack_list_bookmarks',
    auth: 'bot',
    fields: [
      {
        id: 'slack_list_bookmarks_channel_id',
        param: 'channel_id',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'remove_bookmark',
    label: 'Remove Bookmark',
    tool: 'slack_remove_bookmark',
    auth: 'bot',
    fields: [
      {
        id: 'slack_remove_bookmark_channel_id',
        param: 'channel_id',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_remove_bookmark_bookmark_id',
        param: 'bookmark_id',
        title: 'Bookmark ID',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'create_user_group',
    label: 'Create User Group',
    tool: 'slack_create_user_group',
    auth: 'bot',
    fields: [
      {
        id: 'slack_create_user_group_name',
        param: 'name',
        title: 'Name',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_create_user_group_handle',
        param: 'handle',
        title: 'Mention Handle',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_create_user_group_description',
        param: 'description',
        title: 'Description',
        type: 'string',
        required: false,
        allowEmpty: true,
      },
      {
        id: 'slack_create_user_group_channels',
        param: 'channels',
        title: 'Default Channel IDs',
        type: 'json',
        required: false,
      },
      {
        id: 'slack_create_user_group_additional_channels',
        param: 'additional_channels',
        title: 'Additional Channel IDs',
        type: 'json',
        required: false,
      },
      {
        id: 'slack_create_user_group_enable_section',
        param: 'enable_section',
        title: 'Show as Sidebar Section',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_create_user_group_include_count',
        param: 'include_count',
        title: 'Include Member Count',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_create_user_group_team_id',
        param: 'team_id',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'update_user_group',
    label: 'Update User Group',
    tool: 'slack_update_user_group',
    auth: 'bot',
    fields: [
      {
        id: 'slack_update_user_group_usergroup',
        param: 'usergroup',
        title: 'User Group ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_update_user_group_name',
        basic: true,
        param: 'name',
        title: 'Name',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_update_user_group_handle',
        basic: true,
        param: 'handle',
        title: 'Mention Handle',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_update_user_group_description',
        basic: true,
        param: 'description',
        title: 'Description',
        type: 'string',
        required: false,
        allowEmpty: true,
      },
      {
        id: 'slack_update_user_group_channels',
        basic: true,
        param: 'channels',
        title: 'Default Channel IDs',
        type: 'json',
        required: false,
      },
      {
        id: 'slack_update_user_group_additional_channels',
        param: 'additional_channels',
        title: 'Additional Channel IDs',
        type: 'json',
        required: false,
      },
      {
        id: 'slack_update_user_group_enable_section',
        param: 'enable_section',
        title: 'Show as Sidebar Section',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_update_user_group_include_count',
        param: 'include_count',
        title: 'Include Member Count',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_update_user_group_team_id',
        param: 'team_id',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'enable_user_group',
    label: 'Enable User Group',
    tool: 'slack_enable_user_group',
    auth: 'bot',
    fields: [
      {
        id: 'slack_enable_user_group_usergroup',
        param: 'usergroup',
        title: 'User Group ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_enable_user_group_include_count',
        param: 'include_count',
        title: 'Include Member Count',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_enable_user_group_team_id',
        param: 'team_id',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'disable_user_group',
    label: 'Disable User Group',
    tool: 'slack_disable_user_group',
    auth: 'bot',
    fields: [
      {
        id: 'slack_disable_user_group_usergroup',
        param: 'usergroup',
        title: 'User Group ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_disable_user_group_include_count',
        param: 'include_count',
        title: 'Include Member Count',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_disable_user_group_team_id',
        param: 'team_id',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'list_user_groups',
    label: 'List User Groups',
    tool: 'slack_list_user_groups',
    auth: 'bot',
    fields: [
      {
        id: 'slack_list_user_groups_include_disabled',
        param: 'include_disabled',
        title: 'Include Disabled Groups',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_list_user_groups_include_users',
        param: 'include_users',
        title: 'Include Members',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_list_user_groups_include_count',
        param: 'include_count',
        title: 'Include Member Count',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_list_user_groups_team_id',
        param: 'team_id',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'list_user_group_members',
    label: 'List User Group Members',
    tool: 'slack_list_user_group_members',
    auth: 'bot',
    fields: [
      {
        id: 'slack_list_user_group_members_usergroup',
        param: 'usergroup',
        title: 'User Group ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_list_user_group_members_include_disabled',
        param: 'include_disabled',
        title: 'Include Disabled Users',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_list_user_group_members_team_id',
        param: 'team_id',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'update_user_group_members',
    label: 'Update User Group Members',
    tool: 'slack_update_user_group_members',
    auth: 'bot',
    fields: [
      {
        id: 'slack_update_user_group_members_usergroup',
        param: 'usergroup',
        title: 'User Group ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_update_user_group_members_users',
        param: 'users',
        title: 'User IDs',
        type: 'json',
        required: true,
      },
      {
        id: 'slack_update_user_group_members_additional_channels',
        param: 'additional_channels',
        title: 'Additional Channel IDs',
        type: 'json',
        required: false,
      },
      {
        id: 'slack_update_user_group_members_is_shared',
        param: 'is_shared',
        title: 'Shared Section',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_update_user_group_members_include_count',
        param: 'include_count',
        title: 'Include Member Count',
        type: 'boolean',
        required: false,
      },
      {
        id: 'slack_update_user_group_members_team_id',
        param: 'team_id',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'get_dnd_info',
    label: 'Get Do Not Disturb Info',
    tool: 'slack_get_dnd_info',
    auth: 'bot',
    fields: [
      {
        id: 'slack_get_dnd_info_user',
        param: 'user',
        title: 'User ID',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_get_dnd_info_team_id',
        param: 'team_id',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'get_team_dnd_info',
    label: 'Get Team Do Not Disturb Info',
    tool: 'slack_get_team_dnd_info',
    auth: 'bot',
    fields: [
      {
        id: 'slack_get_team_dnd_info_users',
        param: 'users',
        title: 'User IDs',
        type: 'json',
        required: true,
      },
      {
        id: 'slack_get_team_dnd_info_team_id',
        param: 'team_id',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'list_emoji',
    label: 'List Custom Emoji',
    tool: 'slack_list_emoji',
    auth: 'bot',
    fields: [],
  },
  {
    id: 'get_team_info',
    label: 'Get Workspace Info',
    tool: 'slack_get_team_info',
    auth: 'bot',
    fields: [
      {
        id: 'slack_get_team_info_team',
        param: 'team',
        title: 'Workspace ID',
        type: 'string',
        required: false,
      },
      {
        id: 'slack_get_team_info_domain',
        param: 'domain',
        title: 'Workspace Domain',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'get_team_profile',
    label: 'Get Workspace Profile Fields',
    tool: 'slack_get_team_profile',
    auth: 'bot',
    fields: [
      {
        id: 'slack_get_team_profile_visibility',
        param: 'visibility',
        title: 'Visibility',
        type: 'string',
        required: false,
        enum: ['all', 'visible', 'hidden'],
        default: 'all',
      },
    ],
  },
  {
    id: 'unfurl_links',
    label: 'Unfurl Links',
    tool: 'slack_unfurl_links',
    auth: 'bot',
    fields: [
      {
        id: 'slack_unfurl_links_channel',
        param: 'channel',
        title: 'Channel ID',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_unfurl_links_ts',
        param: 'ts',
        title: 'Message Timestamp',
        type: 'string',
        required: true,
      },
      {
        id: 'slack_unfurl_links_unfurls',
        param: 'unfurls',
        title: 'Link Previews',
        type: 'json',
        required: true,
        description:
          'JSON object keyed by each shared URL, with Slack attachment fields or blocks as the value.',
      },
    ],
  },
]

export function getSlackWorkflowOperation(operation: unknown) {
  return SLACK_WORKFLOW_OPERATIONS.find(({ id }) => id === operation)
}

export function getSlackWorkflowSubBlocks(): SubBlockConfig[] {
  const result: SubBlockConfig[] = []
  for (const auth of ['bot', 'any'] as const) {
    const operations = SLACK_WORKFLOW_OPERATIONS.filter((operation) => operation.auth === auth).map(
      ({ id }) => id
    )
    const canonicalParamId = auth === 'bot' ? 'apiBotCredentialId' : 'apiOAuthCredentialId'
    result.push(
      {
        id: auth === 'bot' ? 'apiBotCredential' : 'apiOAuthCredential',
        title: auth === 'bot' ? 'Custom Slack Bot' : 'Slack Account or Bot',
        type: 'oauth-input',
        canonicalParamId,
        serviceId: 'slack',
        credentialKind: auth === 'bot' ? 'service-account' : 'any',
        requiredScopes: getScopesForService('slack'),
        credentialLabels: {
          oauthGroup: 'Sim app',
          oauthConnect: 'Connect the Sim app',
          serviceAccountGroup: 'Custom bots',
          serviceAccountConnect: 'Set up a custom bot',
        },
        mode: 'basic',
        required: true,
        condition: { field: 'operation', value: operations },
      },
      {
        id: auth === 'bot' ? 'manualApiBotCredential' : 'manualApiOAuthCredential',
        title: 'Slack Credential ID',
        type: 'short-input',
        canonicalParamId,
        mode: 'advanced',
        required: true,
        condition: { field: 'operation', value: operations },
      }
    )
  }
  for (const operation of SLACK_WORKFLOW_OPERATIONS) {
    for (const field of operation.fields) {
      result.push({
        id: field.id,
        title: field.title,
        type: field.enum
          ? 'dropdown'
          : field.type === 'json'
            ? 'code'
            : field.type === 'boolean'
              ? 'switch'
              : 'short-input',
        ...(field.type === 'json' ? { language: 'json' as const } : {}),
        ...(field.enum
          ? {
              options: field.options ?? field.enum.map((value) => ({ id: value, label: value })),
              ...(field.dependsOn ? { dependsOn: field.dependsOn } : {}),
              ...(field.default === undefined ? {} : { value: () => field.default! }),
            }
          : {}),
        ...(field.description ? { description: field.description } : {}),
        required: field.required,
        ...(!field.required && !field.enum && !field.basic ? { mode: 'advanced' as const } : {}),
        condition: { field: 'operation', value: operation.id },
      })
    }
  }
  return result
}

export function mapSlackWorkflowParams(
  operation: SlackWorkflowOperation,
  params: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    credential: params[operation.auth === 'bot' ? 'apiBotCredentialId' : 'apiOAuthCredentialId'],
  }
  for (const field of operation.fields) {
    const raw = params[field.id]
    const value =
      raw === undefined || raw === null || (raw === '' && !field.allowEmpty) ? field.default : raw
    if (value === undefined) continue
    if (field.type === 'json') result[field.param] = parseOptionalJsonInput(value, field.title)
    else if (field.type === 'number')
      result[field.param] = parseOptionalNumberInput(value, field.title, {
        integer: true,
        min: field.min,
        max: field.max,
      })
    else if (field.type === 'boolean') {
      const parsed = parseOptionalBooleanInput(value)
      if (parsed === undefined) throw new Error(`${field.title} must be a boolean`)
      result[field.param] = parsed
    } else result[field.param] = value
  }
  return result
}

export const SLACK_WORKFLOW_INPUTS: BlockConfig['inputs'] = {
  apiBotCredentialId: { type: 'string', description: 'Custom Slack bot credential ID' },
  apiOAuthCredentialId: { type: 'string', description: 'Slack credential ID' },
  ...Object.fromEntries(
    SLACK_WORKFLOW_OPERATIONS.flatMap(({ fields }) =>
      fields.map((field) => [
        field.id,
        { type: field.type, description: field.description ?? field.title },
      ])
    )
  ),
}

export const SLACK_WORKFLOW_SENTENCES = Object.fromEntries(
  SLACK_WORKFLOW_OPERATIONS.map(({ id, label }) => [id, [label[0] + label.slice(1).toLowerCase()]])
)
