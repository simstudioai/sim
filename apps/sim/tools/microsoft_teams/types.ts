import { ToolResponse } from '../types'

export interface MicrosoftTeamsMetadata {
  messageId: string
  channelId: string
  teamId: string
  content?: string
  createdTime?: string
  modifiedTime?: string
  url?: string
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
  channelId?: string
  teamId?: string
  content?: string
}
