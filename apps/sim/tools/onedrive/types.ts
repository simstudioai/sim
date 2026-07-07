import type { UserFile } from '@/executor/types'
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

interface OneDriveFile {
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

export interface OneDriveSearchResponse extends ToolResponse {
  output: {
    files: OneDriveFile[]
    nextPageToken?: string
  }
}

export interface OneDriveMoveResponse extends ToolResponse {
  output: {
    file: OneDriveFile
  }
}

export interface OneDriveCopyResponse extends ToolResponse {
  output: {
    sourceFileId: string
    name?: string
    monitorUrl?: string
  }
}

export interface OneDriveShareLinkResponse extends ToolResponse {
  output: {
    link: {
      type: string
      scope?: string
      webUrl: string
      webHtml?: string
    }
  }
}

export interface OneDriveGetItemResponse extends ToolResponse {
  output: {
    file: OneDriveFile
  }
}

export interface OneDriveGetDriveInfoResponse extends ToolResponse {
  output: {
    driveId: string
    driveType: string
    webUrl: string
    owner: string | null
    quota: {
      total: number
      used: number
      remaining: number
      deleted: number
      state: string
    }
  }
}

export interface OneDriveToolParams {
  accessToken: string
  folderSelector?: string
  manualFolderId?: string
  folderName?: string
  fileId?: string
  fileName?: string
  file?: UserFile
  content?: string
  mimeType?: string
  query?: string
  pageSize?: number
  pageToken?: string
  exportMimeType?: string
  // Optional Excel write parameters (used when creating an .xlsx without file content)
  values?:
    | (string | number | boolean | null)[][]
    | Array<Record<string, string | number | boolean | null>>
  // Move/rename parameters
  destinationFolderId?: string
  newName?: string
  // Copy parameters
  destinationFileName?: string
  // Sharing link parameters
  linkType?: 'view' | 'edit' | 'embed'
  linkScope?: 'anonymous' | 'organization' | 'users'
}

export type OneDriveResponse =
  | OneDriveUploadResponse
  | OneDriveDownloadResponse
  | OneDriveListResponse
  | OneDriveDeleteResponse
  | OneDriveSearchResponse
  | OneDriveMoveResponse
  | OneDriveCopyResponse
  | OneDriveShareLinkResponse
  | OneDriveGetItemResponse
  | OneDriveGetDriveInfoResponse
