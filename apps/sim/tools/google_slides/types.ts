import type { ToolResponse } from '@/tools/types'

interface GoogleSlidesMetadata {
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
  revisionId?: string | null
  locale?: string | null
}

interface GoogleSlidesSlideContent {
  objectId: string | null
  index: number
  text: string
  speakerNotes: string
  isSkipped: boolean
}

export interface GoogleSlidesReadResponse extends ToolResponse {
  output: {
    slides: any[]
    slideContents?: GoogleSlidesSlideContent[]
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
