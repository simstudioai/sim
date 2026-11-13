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
    id?: string
    driveId?: string
    driveType?: string
    name?: string
    path?: string
    siteId?: string
  }
  thumbnails?: Array<{
    small?: { url: string }
    medium?: { url: string }
    large?: { url: string }
  }>
  createdBy?: MicrosoftGraphIdentitySet
  lastModifiedBy?: MicrosoftGraphIdentitySet
  description?: string
  eTag?: string
}

/** Graph `identitySet`; each `identity` documents only `id` and `displayName`. */
export interface MicrosoftGraphIdentitySet {
  user?: { id?: string; displayName?: string }
  application?: { id?: string; displayName?: string }
  device?: { id?: string; displayName?: string }
}

export interface OneDriveIdentity {
  id: string | null
  displayName: string | null
}

export interface OneDriveParentReference {
  id: string | null
  driveId: string | null
  driveType: string | null
  name: string | null
  path: string | null
  siteId: string | null
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
  parents?: Array<string | undefined>
  isFolder?: boolean
  childCount?: number | null
  description?: string | null
  eTag?: string | null
  parentReference?: OneDriveParentReference | null
  createdBy?: OneDriveIdentity | null
  lastModifiedBy?: OneDriveIdentity | null
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
      permissionId?: string | null
      roles?: string[]
      hasPassword?: boolean | null
      expirationDateTime?: string | null
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
  folderId?: string
  folderName?: string
  fileId?: string
  fileName?: string
  file?: UserFile
  content?: string
  mimeType?: string
  query?: string
  orderBy?: string
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
  expirationDateTime?: string
  conflictBehavior?: 'fail' | 'replace' | 'rename'
}
