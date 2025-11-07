import type { ToolResponse } from '@/tools/types'

export interface MicrosoftTeamsAttachment {
  id: string
  contentType: string
  contentUrl?: string
  content?: string
  name?: string
  thumbnailUrl?: string
  size?: number
  sourceUrl?: string
  providerType?: string
  item?: any
}

export interface MicrosoftTeamsMetadata {
  messageId?: string
  channelId?: string
  teamId?: string
  chatId?: string
  content?: string
  createdTime?: string
  url?: string
  messageCount?: number
  messages?: Array<{
    id: string
    content: string
    sender: string
    timestamp: string
    messageType: string
    attachments?: MicrosoftTeamsAttachment[]
    uploadedFiles?: {
      path: string
      key: string
      name: string
      size: number
      type: string
    }[]
  }>
  // Global attachments summary
  totalAttachments?: number
  attachmentTypes?: string[]
}

export interface MicrosoftTeamsReadResponse extends ToolResponse {
  output: {
    content: string
    metadata: MicrosoftTeamsMetadata
    attachments?: Array<{
      path: string
      key: string
      name: string
      size: number
      type: string
    }>
  }
}

export interface MicrosoftTeamsWriteResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: MicrosoftTeamsMetadata
  }
}

export interface MicrosoftTeamsToolParams {
  accessToken: string
  messageId?: string
  chatId?: string
  channelId?: string
  teamId?: string
  content?: string
  includeAttachments?: boolean
  files?: any[] // UserFile array for attachments
  reactionType?: string // For reaction operations
}

// Update message params
export interface MicrosoftTeamsUpdateMessageParams extends MicrosoftTeamsToolParams {
  messageId: string
  content: string
}

// Delete message params
export interface MicrosoftTeamsDeleteMessageParams extends MicrosoftTeamsToolParams {
  messageId: string
}

// Reply to message params
export interface MicrosoftTeamsReplyParams extends MicrosoftTeamsToolParams {
  messageId: string
  content: string
}

// Reaction params
export interface MicrosoftTeamsReactionParams extends MicrosoftTeamsToolParams {
  messageId: string
  reactionType: string
}

// Get message params
export interface MicrosoftTeamsGetMessageParams extends MicrosoftTeamsToolParams {
  messageId: string
}

// Member list response
export interface MicrosoftTeamsMember {
  id: string
  displayName: string
  email?: string
  userId?: string
  roles?: string[]
}

export interface MicrosoftTeamsListMembersResponse extends ToolResponse {
  output: {
    members: MicrosoftTeamsMember[]
    memberCount: number
    metadata: {
      teamId?: string
      channelId?: string
    }
  }
}

// Delete response
export interface MicrosoftTeamsDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    messageId: string
    metadata: MicrosoftTeamsMetadata
  }
}

// Reaction response
export interface MicrosoftTeamsReactionResponse extends ToolResponse {
  output: {
    success: boolean
    reactionType: string
    messageId: string
    metadata: MicrosoftTeamsMetadata
  }
}

export type MicrosoftTeamsResponse =
  | MicrosoftTeamsReadResponse
  | MicrosoftTeamsWriteResponse
  | MicrosoftTeamsDeleteResponse
  | MicrosoftTeamsListMembersResponse
  | MicrosoftTeamsReactionResponse
