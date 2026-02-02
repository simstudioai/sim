import type { UserFile } from '@/executor/types'
import type { OutputProperty, ToolFileData, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Slack API responses.
 * These are reusable across all Slack tools to ensure consistency.
 * Based on official Slack API documentation:
 * - https://api.slack.com/types/user
 * - https://api.slack.com/types/conversation
 * - https://api.slack.com/methods/chat.postMessage
 * - https://api.slack.com/events/message
 */

/**
 * Output definition for reaction objects on messages
 * Based on Slack API reactions structure
 */
export const REACTION_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Emoji name (without colons)' },
  count: { type: 'number', description: 'Number of times this reaction was added' },
  users: {
    type: 'array',
    description: 'Array of user IDs who reacted',
    items: { type: 'string', description: 'User ID' },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete reaction array output definition
 */
export const REACTIONS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Reactions on this message',
  items: {
    type: 'object',
    properties: REACTION_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for message edit information
 * Based on Slack API edited object structure
 */
export const MESSAGE_EDITED_OUTPUT_PROPERTIES = {
  user: { type: 'string', description: 'User ID who edited the message' },
  ts: { type: 'string', description: 'Timestamp of the edit' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete message edited output definition
 */
export const MESSAGE_EDITED_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Edit information if message was edited',
  optional: true,
  properties: MESSAGE_EDITED_OUTPUT_PROPERTIES,
}

/**
 * Output definition for file objects attached to messages
 * Based on Slack API file object structure
 */
export const FILE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique file identifier' },
  name: { type: 'string', description: 'File name' },
  mimetype: { type: 'string', description: 'MIME type of the file' },
  size: { type: 'number', description: 'File size in bytes' },
  url_private: {
    type: 'string',
    description: 'Private download URL (requires auth)',
    optional: true,
  },
  permalink: { type: 'string', description: 'Permanent link to the file', optional: true },
  mode: { type: 'string', description: 'File mode (hosted, external, etc.)', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete files array output definition
 */
export const FILES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Files attached to the message',
  items: {
    type: 'object',
    properties: FILE_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for Block Kit block objects
 * Based on Slack Block Kit structure
 */
export const BLOCK_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Block type (section, divider, image, actions, etc.)' },
  block_id: { type: 'string', description: 'Unique block identifier', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete blocks array output definition
 */
export const BLOCKS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Block Kit blocks in the message',
  items: {
    type: 'object',
    properties: BLOCK_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for legacy attachment objects
 * Based on Slack API secondary attachments structure
 */
export const ATTACHMENT_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Attachment ID', optional: true },
  fallback: { type: 'string', description: 'Plain text summary', optional: true },
  text: { type: 'string', description: 'Main attachment text', optional: true },
  pretext: { type: 'string', description: 'Text shown before attachment', optional: true },
  color: { type: 'string', description: 'Color bar hex code or preset', optional: true },
  author_name: { type: 'string', description: 'Author display name', optional: true },
  author_link: { type: 'string', description: 'Author link URL', optional: true },
  author_icon: { type: 'string', description: 'Author icon URL', optional: true },
  title: { type: 'string', description: 'Attachment title', optional: true },
  title_link: { type: 'string', description: 'Title link URL', optional: true },
  image_url: { type: 'string', description: 'Image URL', optional: true },
  thumb_url: { type: 'string', description: 'Thumbnail URL', optional: true },
  footer: { type: 'string', description: 'Footer text', optional: true },
  footer_icon: { type: 'string', description: 'Footer icon URL', optional: true },
  ts: { type: 'string', description: 'Timestamp shown in footer', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete attachments array output definition
 */
export const ATTACHMENTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Legacy attachments on the message',
  items: {
    type: 'object',
    properties: ATTACHMENT_OUTPUT_PROPERTIES,
  },
}

/**
 * Core message properties shared across all message-related tools
 * Based on Slack message event structure
 */
export const MESSAGE_CORE_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Message type (usually "message")' },
  ts: { type: 'string', description: 'Message timestamp (unique identifier)' },
  text: { type: 'string', description: 'Message text content' },
  user: { type: 'string', description: 'User ID who sent the message', optional: true },
  bot_id: { type: 'string', description: 'Bot ID if sent by a bot', optional: true },
  username: { type: 'string', description: 'Display username', optional: true },
  channel: { type: 'string', description: 'Channel ID', optional: true },
  team: { type: 'string', description: 'Team/workspace ID', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Thread-related message properties
 * Based on Slack threading structure
 */
export const MESSAGE_THREAD_OUTPUT_PROPERTIES = {
  thread_ts: {
    type: 'string',
    description: 'Parent message timestamp (for threaded replies)',
    optional: true,
  },
  parent_user_id: {
    type: 'string',
    description: 'User ID of thread parent message author',
    optional: true,
  },
  reply_count: { type: 'number', description: 'Total number of replies in thread', optional: true },
  reply_users_count: {
    type: 'number',
    description: 'Number of unique users who replied',
    optional: true,
  },
  latest_reply: { type: 'string', description: 'Timestamp of most recent reply', optional: true },
  subscribed: {
    type: 'boolean',
    description: 'Whether user is subscribed to thread',
    optional: true,
  },
  last_read: { type: 'string', description: 'Timestamp of last read message', optional: true },
  unread_count: {
    type: 'number',
    description: 'Number of unread messages in thread',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Message interaction properties (stars, pins, etc.)
 */
export const MESSAGE_INTERACTION_OUTPUT_PROPERTIES = {
  subtype: {
    type: 'string',
    description: 'Message subtype (bot_message, file_share, etc.)',
    optional: true,
  },
  is_starred: {
    type: 'boolean',
    description: 'Whether message is starred by user',
    optional: true,
  },
  pinned_to: {
    type: 'array',
    description: 'Channel IDs where message is pinned',
    items: { type: 'string', description: 'Channel ID' },
    optional: true,
  },
  permalink: { type: 'string', description: 'Permanent URL to the message', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete message output properties combining all message-related properties
 */
export const MESSAGE_OUTPUT_PROPERTIES = {
  ...MESSAGE_CORE_OUTPUT_PROPERTIES,
  ...MESSAGE_THREAD_OUTPUT_PROPERTIES,
  ...MESSAGE_INTERACTION_OUTPUT_PROPERTIES,
  reactions: REACTIONS_OUTPUT,
  files: FILES_OUTPUT,
  attachments: ATTACHMENTS_OUTPUT,
  blocks: BLOCKS_OUTPUT,
  edited: MESSAGE_EDITED_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Complete message object output definition
 */
export const MESSAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Slack message object',
  properties: MESSAGE_OUTPUT_PROPERTIES,
}

/**
 * Messages array output definition for list/reader tools
 */
export const MESSAGES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of message objects',
  items: {
    type: 'object',
    properties: MESSAGE_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for channel topic/purpose nested objects
 * Based on Slack conversation object structure
 */
export const CHANNEL_TOPIC_OUTPUT_PROPERTIES = {
  value: { type: 'string', description: 'Topic or purpose text' },
  creator: { type: 'string', description: 'User ID who set it' },
  last_set: { type: 'number', description: 'Unix timestamp when last set' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for channel objects
 * Based on Slack conversation object (https://api.slack.com/types/conversation)
 */
export const CHANNEL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Channel ID (e.g., C1234567890)' },
  name: { type: 'string', description: 'Channel name without # prefix' },
  is_channel: { type: 'boolean', description: 'Whether this is a channel', optional: true },
  is_private: { type: 'boolean', description: 'Whether channel is private' },
  is_archived: { type: 'boolean', description: 'Whether channel is archived' },
  is_general: {
    type: 'boolean',
    description: 'Whether this is the general channel',
    optional: true,
  },
  is_member: { type: 'boolean', description: 'Whether the bot/user is a member' },
  is_shared: {
    type: 'boolean',
    description: 'Whether channel is shared across workspaces',
    optional: true,
  },
  is_ext_shared: {
    type: 'boolean',
    description: 'Whether channel is externally shared',
    optional: true,
  },
  is_org_shared: {
    type: 'boolean',
    description: 'Whether channel is org-wide shared',
    optional: true,
  },
  num_members: { type: 'number', description: 'Number of members in the channel', optional: true },
  topic: { type: 'string', description: 'Channel topic' },
  purpose: { type: 'string', description: 'Channel purpose/description' },
  created: {
    type: 'number',
    description: 'Unix timestamp when channel was created',
    optional: true,
  },
  creator: { type: 'string', description: 'User ID of channel creator', optional: true },
  updated: { type: 'number', description: 'Unix timestamp of last update', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete channel object output definition
 */
export const CHANNEL_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Slack channel object',
  properties: CHANNEL_OUTPUT_PROPERTIES,
}

/**
 * Channels array output definition
 */
export const CHANNELS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of channel objects',
  items: {
    type: 'object',
    properties: CHANNEL_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for user profile objects (nested in user)
 * Based on Slack user profile object
 */
export const USER_PROFILE_OUTPUT_PROPERTIES = {
  real_name: { type: 'string', description: 'Full real name' },
  real_name_normalized: { type: 'string', description: 'Normalized real name', optional: true },
  display_name: { type: 'string', description: 'Display name shown in Slack' },
  display_name_normalized: {
    type: 'string',
    description: 'Normalized display name',
    optional: true,
  },
  first_name: { type: 'string', description: 'First name', optional: true },
  last_name: { type: 'string', description: 'Last name', optional: true },
  title: { type: 'string', description: 'Job title', optional: true },
  phone: { type: 'string', description: 'Phone number', optional: true },
  skype: { type: 'string', description: 'Skype handle', optional: true },
  email: {
    type: 'string',
    description: 'Email address (requires users:read.email scope)',
    optional: true,
  },
  status_text: { type: 'string', description: 'Custom status text', optional: true },
  status_emoji: { type: 'string', description: 'Custom status emoji', optional: true },
  status_expiration: {
    type: 'number',
    description: 'Unix timestamp when status expires',
    optional: true,
  },
  image_24: { type: 'string', description: 'URL to 24px avatar', optional: true },
  image_32: { type: 'string', description: 'URL to 32px avatar', optional: true },
  image_48: { type: 'string', description: 'URL to 48px avatar', optional: true },
  image_72: { type: 'string', description: 'URL to 72px avatar', optional: true },
  image_192: { type: 'string', description: 'URL to 192px avatar', optional: true },
  image_512: { type: 'string', description: 'URL to 512px avatar', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for user objects
 * Based on Slack user object (https://api.slack.com/types/user)
 */
export const USER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'User ID (e.g., U1234567890)' },
  team_id: { type: 'string', description: 'Workspace/team ID', optional: true },
  name: { type: 'string', description: 'Username (handle)' },
  real_name: { type: 'string', description: 'Full real name' },
  display_name: { type: 'string', description: 'Display name shown in Slack' },
  first_name: { type: 'string', description: 'First name', optional: true },
  last_name: { type: 'string', description: 'Last name', optional: true },
  title: { type: 'string', description: 'Job title', optional: true },
  phone: { type: 'string', description: 'Phone number', optional: true },
  skype: { type: 'string', description: 'Skype handle', optional: true },
  is_bot: { type: 'boolean', description: 'Whether the user is a bot' },
  is_admin: { type: 'boolean', description: 'Whether the user is a workspace admin' },
  is_owner: { type: 'boolean', description: 'Whether the user is the workspace owner' },
  is_primary_owner: {
    type: 'boolean',
    description: 'Whether the user is the primary owner',
    optional: true,
  },
  is_restricted: {
    type: 'boolean',
    description: 'Whether the user is a guest (restricted)',
    optional: true,
  },
  is_ultra_restricted: {
    type: 'boolean',
    description: 'Whether the user is a single-channel guest',
    optional: true,
  },
  is_app_user: { type: 'boolean', description: 'Whether user is an app user', optional: true },
  is_stranger: {
    type: 'boolean',
    description: 'Whether user is from different workspace',
    optional: true,
  },
  deleted: { type: 'boolean', description: 'Whether the user is deactivated' },
  color: { type: 'string', description: 'User color for display', optional: true },
  timezone: {
    type: 'string',
    description: 'Timezone identifier (e.g., America/Los_Angeles)',
    optional: true,
  },
  timezone_label: { type: 'string', description: 'Human-readable timezone label', optional: true },
  timezone_offset: {
    type: 'number',
    description: 'Timezone offset in seconds from UTC',
    optional: true,
  },
  avatar: { type: 'string', description: 'URL to user avatar image', optional: true },
  avatar_24: { type: 'string', description: 'URL to 24px avatar', optional: true },
  avatar_48: { type: 'string', description: 'URL to 48px avatar', optional: true },
  avatar_72: { type: 'string', description: 'URL to 72px avatar', optional: true },
  avatar_192: { type: 'string', description: 'URL to 192px avatar', optional: true },
  avatar_512: { type: 'string', description: 'URL to 512px avatar', optional: true },
  status_text: { type: 'string', description: 'Custom status text', optional: true },
  status_emoji: { type: 'string', description: 'Custom status emoji', optional: true },
  status_expiration: {
    type: 'number',
    description: 'Unix timestamp when status expires',
    optional: true,
  },
  updated: { type: 'number', description: 'Unix timestamp of last profile update', optional: true },
  has_2fa: { type: 'boolean', description: 'Whether two-factor auth is enabled', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Simplified user output properties for list endpoints
 */
export const USER_SUMMARY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'User ID (e.g., U1234567890)' },
  name: { type: 'string', description: 'Username (handle)' },
  real_name: { type: 'string', description: 'Full real name' },
  display_name: { type: 'string', description: 'Display name shown in Slack' },
  is_bot: { type: 'boolean', description: 'Whether the user is a bot' },
  is_admin: { type: 'boolean', description: 'Whether the user is a workspace admin' },
  is_owner: { type: 'boolean', description: 'Whether the user is the workspace owner' },
  deleted: { type: 'boolean', description: 'Whether the user is deactivated' },
  timezone: { type: 'string', description: 'User timezone identifier', optional: true },
  avatar: { type: 'string', description: 'URL to user avatar image', optional: true },
  status_text: { type: 'string', description: 'Custom status text', optional: true },
  status_emoji: { type: 'string', description: 'Custom status emoji', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete user object output definition
 */
export const USER_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Slack user object',
  properties: USER_OUTPUT_PROPERTIES,
}

/**
 * Users array output definition
 */
export const USERS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of user objects',
  items: {
    type: 'object',
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
}

/**
 * Canvas output properties
 */
export const CANVAS_OUTPUT_PROPERTIES = {
  canvas_id: { type: 'string', description: 'Unique canvas identifier' },
  channel: { type: 'string', description: 'Channel where canvas was created' },
  title: { type: 'string', description: 'Canvas title' },
} as const satisfies Record<string, OutputProperty>

/**
 * File download output properties
 */
export const FILE_DOWNLOAD_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'File name' },
  mimeType: { type: 'string', description: 'MIME type of the file' },
  data: { type: 'string', description: 'File content (base64 encoded)' },
  size: { type: 'number', description: 'File size in bytes' },
} as const satisfies Record<string, OutputProperty>

/**
 * Metadata output for message operations (update, delete, reaction)
 */
export const MESSAGE_METADATA_OUTPUT_PROPERTIES = {
  channel: { type: 'string', description: 'Channel ID' },
  timestamp: { type: 'string', description: 'Message timestamp' },
} as const satisfies Record<string, OutputProperty>

/**
 * Reaction metadata output properties
 */
export const REACTION_METADATA_OUTPUT_PROPERTIES = {
  ...MESSAGE_METADATA_OUTPUT_PROPERTIES,
  reaction: { type: 'string', description: 'Emoji reaction name' },
} as const satisfies Record<string, OutputProperty>

export interface SlackBaseParams {
  authMethod: 'oauth' | 'bot_token'
  accessToken: string
  botToken: string
}

export interface SlackMessageParams extends SlackBaseParams {
  destinationType?: 'channel' | 'dm'
  channel?: string
  dmUserId?: string
  userId?: string
  text: string
  thread_ts?: string
  files?: UserFile[]
}

export interface SlackCanvasParams extends SlackBaseParams {
  channel: string
  title: string
  content: string
  document_content?: object
}

export interface SlackMessageReaderParams extends SlackBaseParams {
  destinationType?: 'channel' | 'dm'
  channel?: string
  dmUserId?: string
  userId?: string
  limit?: number
  oldest?: string
  latest?: string
}

export interface SlackDownloadParams extends SlackBaseParams {
  fileId: string
  fileName?: string
}

export interface SlackUpdateMessageParams extends SlackBaseParams {
  channel: string
  timestamp: string
  text: string
}

export interface SlackDeleteMessageParams extends SlackBaseParams {
  channel: string
  timestamp: string
}

export interface SlackAddReactionParams extends SlackBaseParams {
  channel: string
  timestamp: string
  name: string
}

export interface SlackListChannelsParams extends SlackBaseParams {
  includePrivate?: boolean
  excludeArchived?: boolean
  limit?: number
}

export interface SlackListMembersParams extends SlackBaseParams {
  channel: string
  limit?: number
}

export interface SlackListUsersParams extends SlackBaseParams {
  includeDeleted?: boolean
  limit?: number
}

export interface SlackGetUserParams extends SlackBaseParams {
  userId: string
}

export interface SlackGetMessageParams extends SlackBaseParams {
  channel: string
  timestamp: string
}

export interface SlackGetThreadParams extends SlackBaseParams {
  channel: string
  threadTs: string
  limit?: number
}

export interface SlackMessageResponse extends ToolResponse {
  output: {
    // Legacy properties for backward compatibility
    ts: string
    channel: string
    fileCount?: number
    files?: ToolFileData[]
    // New comprehensive message object
    message: SlackMessage
  }
}

export interface SlackCanvasResponse extends ToolResponse {
  output: {
    canvas_id: string
    channel: string
    title: string
  }
}

export interface SlackReaction {
  name: string
  count: number
  users: string[]
}

export interface SlackMessageEdited {
  user: string
  ts: string
}

export interface SlackAttachment {
  id?: number
  fallback?: string
  text?: string
  pretext?: string
  color?: string
  fields?: Array<{
    title: string
    value: string
    short?: boolean
  }>
  author_name?: string
  author_link?: string
  author_icon?: string
  title?: string
  title_link?: string
  image_url?: string
  thumb_url?: string
  footer?: string
  footer_icon?: string
  ts?: string
}

export interface SlackBlock {
  type: string
  block_id?: string
  [key: string]: any // Blocks can have various properties depending on type
}

export interface SlackMessage {
  // Core properties
  type: string
  ts: string
  text: string
  user?: string
  bot_id?: string
  username?: string
  channel?: string
  team?: string

  // Thread properties
  thread_ts?: string
  parent_user_id?: string
  reply_count?: number
  reply_users_count?: number
  latest_reply?: string
  subscribed?: boolean
  last_read?: string
  unread_count?: number

  // Message subtype
  subtype?: string

  // Reactions and interactions
  reactions?: SlackReaction[]
  is_starred?: boolean
  pinned_to?: string[]

  // Content attachments
  files?: Array<{
    id: string
    name: string
    mimetype: string
    size: number
    url_private?: string
    permalink?: string
    mode?: string
  }>
  attachments?: SlackAttachment[]
  blocks?: SlackBlock[]

  // Metadata
  edited?: SlackMessageEdited
  permalink?: string
}

export interface SlackMessageReaderResponse extends ToolResponse {
  output: {
    messages: SlackMessage[]
  }
}

export interface SlackDownloadResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: Buffer | string // Buffer for direct use, string for base64-encoded data
      size: number
    }
  }
}

export interface SlackUpdateMessageResponse extends ToolResponse {
  output: {
    // Legacy properties for backward compatibility
    content: string
    metadata: {
      channel: string
      timestamp: string
      text: string
    }
    // New comprehensive message object
    message: SlackMessage
  }
}

export interface SlackDeleteMessageResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      channel: string
      timestamp: string
    }
  }
}

export interface SlackAddReactionResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      channel: string
      timestamp: string
      reaction: string
    }
  }
}

export interface SlackChannel {
  id: string
  name: string
  is_private: boolean
  is_archived: boolean
  is_member: boolean
  num_members?: number
  topic?: string
  purpose?: string
  created?: number
  creator?: string
}

export interface SlackListChannelsResponse extends ToolResponse {
  output: {
    channels: SlackChannel[]
    ids: string[]
    names: string[]
    count: number
  }
}

export interface SlackListMembersResponse extends ToolResponse {
  output: {
    members: string[]
    count: number
  }
}

export interface SlackUser {
  id: string
  name: string
  real_name: string
  display_name: string
  first_name?: string
  last_name?: string
  title?: string
  phone?: string
  skype?: string
  is_bot: boolean
  is_admin: boolean
  is_owner: boolean
  is_primary_owner?: boolean
  is_restricted?: boolean
  is_ultra_restricted?: boolean
  deleted: boolean
  timezone?: string
  timezone_label?: string
  timezone_offset?: number
  avatar?: string
  avatar_24?: string
  avatar_48?: string
  avatar_72?: string
  avatar_192?: string
  avatar_512?: string
  status_text?: string
  status_emoji?: string
  status_expiration?: number
  updated?: number
}

export interface SlackListUsersResponse extends ToolResponse {
  output: {
    users: SlackUser[]
    ids: string[]
    names: string[]
    count: number
  }
}

export interface SlackGetUserResponse extends ToolResponse {
  output: {
    user: SlackUser
  }
}

export interface SlackGetMessageResponse extends ToolResponse {
  output: {
    message: SlackMessage
  }
}

export interface SlackGetThreadResponse extends ToolResponse {
  output: {
    parentMessage: SlackMessage
    replies: SlackMessage[]
    messages: SlackMessage[]
    replyCount: number
    hasMore: boolean
  }
}

export type SlackResponse =
  | SlackCanvasResponse
  | SlackMessageReaderResponse
  | SlackMessageResponse
  | SlackDownloadResponse
  | SlackUpdateMessageResponse
  | SlackDeleteMessageResponse
  | SlackAddReactionResponse
  | SlackListChannelsResponse
  | SlackListMembersResponse
  | SlackListUsersResponse
  | SlackGetUserResponse
  | SlackGetMessageResponse
  | SlackGetThreadResponse
