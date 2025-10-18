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
}

export type MicrosoftTeamsResponse = MicrosoftTeamsReadResponse | MicrosoftTeamsWriteResponse
