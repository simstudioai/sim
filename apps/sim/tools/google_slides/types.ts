import type { ToolResponse } from '@/tools/types'

export interface GoogleSlidesMetadata {
  presentationId: string
  title: string
  pageSize?: {
    width: number
    height: number
  }
  mimeType?: string
  createdTime?: string
  modifiedTime?: string
  url?: string
}

export interface GoogleSlidesReadResponse extends ToolResponse {
  output: {
    slides: any[]
    metadata: GoogleSlidesMetadata
  }
}

export interface GoogleSlidesWriteResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: GoogleSlidesMetadata
  }
}

export interface GoogleSlidesCreateResponse extends ToolResponse {
  output: {
    metadata: GoogleSlidesMetadata
  }
}

export interface GoogleSlidesToolParams {
  accessToken: string
  presentationId?: string
  manualPresentationId?: string
  title?: string
  content?: string
  slideIndex?: number
  folderId?: string
  folderSelector?: string
}

export type GoogleSlidesResponse =
  | GoogleSlidesReadResponse
  | GoogleSlidesWriteResponse
  | GoogleSlidesCreateResponse
