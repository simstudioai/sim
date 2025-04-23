import { ToolResponse } from '../types'

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

export interface GoogleDriveDownloadResponse extends ToolResponse {
  output: {
    content: string
    metadata: GoogleDriveFile
  }
}

export interface GoogleDriveToolParams {
  accessToken: string
  folderId?: string
  fileId?: string
  fileName?: string
  content?: string
  mimeType?: string
  query?: string
  pageSize?: number
  pageToken?: string
}
