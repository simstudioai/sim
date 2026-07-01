import type { ToolResponse } from '@/tools/types'

interface GoogleDocsMetadata {
  documentId: string
  title: string
  mimeType?: string
  createdTime?: string
  modifiedTime?: string
  url?: string
}

export interface GoogleDocsReadResponse extends ToolResponse {
  output: {
    content: string
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsWriteResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsCreateResponse extends ToolResponse {
  output: {
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsInsertTextResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsReplaceTextResponse extends ToolResponse {
  output: {
    occurrencesChanged: number
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsInsertTableResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsInsertImageResponse extends ToolResponse {
  output: {
    objectId: string | null
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsInsertPageBreakResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsUpdateTextStyleResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsDeleteContentRangeResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsUpdateParagraphStyleResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsCreateParagraphBulletsResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsDeleteParagraphBulletsResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsCreateNamedRangeResponse extends ToolResponse {
  output: {
    namedRangeId: string | null
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsDeleteNamedRangeResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: GoogleDocsMetadata
  }
}

export interface GoogleDocsToolParams {
  accessToken: string
  documentId?: string
  manualDocumentId?: string
  title?: string
  content?: string
  folderId?: string
  folderSelector?: string
  markdown?: boolean
  text?: string
  index?: number
  searchText?: string
  replaceText?: string
  matchCase?: boolean
  rows?: number
  columns?: number
  imageUrl?: string
  width?: number
  height?: number
  startIndex?: number
  endIndex?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontSize?: number
  namedStyleType?: string
  alignment?: string
  bulletPreset?: string
  name?: string
  namedRangeId?: string
  namedRangeName?: string
}

export type GoogleDocsResponse =
  | GoogleDocsReadResponse
  | GoogleDocsWriteResponse
  | GoogleDocsCreateResponse
  | GoogleDocsInsertTextResponse
  | GoogleDocsReplaceTextResponse
  | GoogleDocsInsertTableResponse
  | GoogleDocsInsertImageResponse
  | GoogleDocsInsertPageBreakResponse
  | GoogleDocsUpdateTextStyleResponse
  | GoogleDocsDeleteContentRangeResponse
  | GoogleDocsUpdateParagraphStyleResponse
  | GoogleDocsCreateParagraphBulletsResponse
  | GoogleDocsDeleteParagraphBulletsResponse
  | GoogleDocsCreateNamedRangeResponse
  | GoogleDocsDeleteNamedRangeResponse
