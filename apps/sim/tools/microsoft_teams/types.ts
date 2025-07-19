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
  }>
  // Global attachments summary
  totalAttachments?: number
  attachmentTypes?: string[]
}

export interface MicrosoftTeamsReadResponse extends ToolResponse {
  output: {
    content: string
    metadata: MicrosoftTeamsMetadata
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
}

export type MicrosoftTeamsResponse = MicrosoftTeamsReadResponse | MicrosoftTeamsWriteResponse
