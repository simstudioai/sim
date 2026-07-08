import type { UserFile } from '@/executor/types'
import type { ToolFileData, ToolResponse } from '@/tools/types'

export interface GraphApiErrorResponse {
  error?: {
    message?: string
  }
}

export interface GraphDriveItem {
  id: string
  webUrl?: string
  webDavUrl?: string
  eTag?: string
  name?: string
  size?: number
}

export interface GraphChatMessage {
  id?: string
  chatId?: string
  channelIdentity?: { teamId?: string; channelId?: string }
  body?: { content?: string }
  createdDateTime?: string
  webUrl?: string
}

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

interface MicrosoftTeamsMetadata {
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
    files?: ToolFileData[]
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
  files?: UserFile[]
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
interface MicrosoftTeamsMember {
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
    hasMore?: boolean
    metadata: {
      teamId?: string
      channelId?: string
      chatId?: string
    }
  }
}

// Joined team summary (from GET /me/joinedTeams)
interface MicrosoftTeamsTeamSummary {
  id: string
  displayName: string
  description?: string
  isArchived?: boolean
}

export interface MicrosoftTeamsListTeamsResponse extends ToolResponse {
  output: {
    teams: MicrosoftTeamsTeamSummary[]
    teamCount: number
    hasMore: boolean
  }
}

// Chat summary (from GET /me/chats)
interface MicrosoftTeamsChatSummary {
  id: string
  topic: string | null
  chatType: string
  webUrl?: string
  createdDateTime?: string
  lastUpdatedDateTime?: string
}

export interface MicrosoftTeamsListChatsResponse extends ToolResponse {
  output: {
    chats: MicrosoftTeamsChatSummary[]
    chatCount: number
    hasMore: boolean
  }
}

// Channel summary (from GET /teams/{team-id}/channels)
interface MicrosoftTeamsChannelSummary {
  id: string
  displayName: string
  description?: string | null
  membershipType?: string
  webUrl?: string
}

export interface MicrosoftTeamsListChannelsResponse extends ToolResponse {
  output: {
    channels: MicrosoftTeamsChannelSummary[]
    channelCount: number
    hasMore: boolean
    metadata: {
      teamId: string
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
  | MicrosoftTeamsListTeamsResponse
  | MicrosoftTeamsListChatsResponse
  | MicrosoftTeamsListChannelsResponse
