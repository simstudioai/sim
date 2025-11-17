import type { ToolResponse } from '@/tools/types'

export interface SlackBaseParams {
  authMethod: 'oauth' | 'bot_token'
  accessToken: string
  botToken: string
}

export interface SlackMessageParams extends SlackBaseParams {
  channel: string
  text: string
  thread_ts?: string
  files?: any[]
}

export interface SlackCanvasParams extends SlackBaseParams {
  channel: string
  title: string
  content: string
  document_content?: object
}

export interface SlackMessageReaderParams extends SlackBaseParams {
  channel: string
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

export interface SlackMessageResponse extends ToolResponse {
  output: {
    // Legacy properties for backward compatibility
    ts: string
    channel: string
    fileCount?: number
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

export type SlackResponse =
  | SlackCanvasResponse
  | SlackMessageReaderResponse
  | SlackMessageResponse
  | SlackDownloadResponse
  | SlackUpdateMessageResponse
  | SlackDeleteMessageResponse
  | SlackAddReactionResponse
