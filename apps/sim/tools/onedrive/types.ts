import type { ToolResponse } from '@/tools/types'

export interface MicrosoftGraphDriveItem {
  id: string
  name: string
  file?: {
    mimeType: string
  }
  folder?: {
    childCount: number
  }
  webUrl: string
  createdDateTime: string
  lastModifiedDateTime: string
  size?: number
  '@microsoft.graph.downloadUrl'?: string
  parentReference?: {
    id: string
    driveId: string
    path: string
  }
  thumbnails?: Array<{
    small?: { url: string }
    medium?: { url: string }
    large?: { url: string }
  }>
  createdBy?: {
    user?: {
      displayName?: string
      email?: string
    }
  }
}

export interface OneDriveFile {
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

export interface OneDriveListResponse extends ToolResponse {
  output: {
    files: OneDriveFile[]
    nextPageToken?: string
  }
}

export interface OneDriveUploadResponse extends ToolResponse {
  output: {
    file: OneDriveFile
    excelWriteResult?: {
      success: boolean
      updatedRange?: string
      updatedRows?: number
      updatedColumns?: number
      updatedCells?: number
      error?: string
      details?: string
    }
  }
}

export interface OneDriveDownloadResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: Buffer | string // Buffer for direct use, string for base64-encoded data
      size: number
    }
  }
}

export interface OneDriveDeleteResponse extends ToolResponse {
  output: {
    fileId: string
    deleted: boolean
  }
}

export interface OneDriveToolParams {
  accessToken: string
  folderSelector?: string
  manualFolderId?: string
  folderName?: string
  fileId?: string
  fileName?: string
  file?: unknown // UserFile or UserFile array
  content?: string
  mimeType?: string
  query?: string
  pageSize?: number
  pageToken?: string
  exportMimeType?: string
  // Optional Excel write parameters (used when creating an .xlsx without file content)
  values?: (string | number | boolean | null)[][]
}

export type OneDriveResponse =
  | OneDriveUploadResponse
  | OneDriveDownloadResponse
  | OneDriveListResponse
  | OneDriveDeleteResponse
