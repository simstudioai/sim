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
  }
}

export interface OneDriveToolParams {
  accessToken: string
  folderId?: string
  folderSelector?: string
  folderName?: string
  fileId?: string
  fileName?: string
  content?: string
  mimeType?: string
  query?: string
  pageSize?: number
  pageToken?: string
  exportMimeType?: string
}

export type OneDriveResponse = OneDriveUploadResponse | OneDriveListResponse
