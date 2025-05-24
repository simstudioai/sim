import type { ToolResponse } from '../types'

export interface GoogleDocsMetadata {
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

export interface GoogleDocsToolParams {
  accessToken: string
  documentId?: string
  manualDocumentId?: string
  title?: string
  content?: string
  folderId?: string
  folderSelector?: string
}
