import type { ToolResponse } from '@/tools/types'

export interface GoogleDriveFile {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  webContentLink?: string
  size?: string
  createdTime?: string
  modifiedTime?: string
  parents?: string[]
}

export interface GoogleDriveListResponse extends ToolResponse {
  output: {
    files: GoogleDriveFile[]
    nextPageToken?: string
  }
}

export interface GoogleDriveUploadResponse extends ToolResponse {
  output: {
    file: GoogleDriveFile
  }
}

export interface GoogleDriveGetContentResponse extends ToolResponse {
  output: {
    content: string
    metadata: GoogleDriveFile
  }
}

export interface GoogleDriveToolParams {
  accessToken: string
  folderId?: string
  folderSelector?: string
  fileId?: string
  fileName?: string
  content?: string
  mimeType?: string
  query?: string
  pageSize?: number
  pageToken?: string
  exportMimeType?: string
}

export type GoogleDriveResponse =
  | GoogleDriveUploadResponse
  | GoogleDriveGetContentResponse
  | GoogleDriveListResponse
