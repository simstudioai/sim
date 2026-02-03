import type { UserFileLike } from '@/lib/core/utils/user-file'
import type { ToolFileData, ToolResponse } from '@/tools/types'

// ===== Core Types =====

export interface DropboxFileMetadata {
  '.tag': 'file'
  id: string
  name: string
  path_display: string
  path_lower: string
  size: number
  client_modified: string
  server_modified: string
  rev: string
  content_hash?: string
  is_downloadable?: boolean
}

export interface DropboxFolderMetadata {
  '.tag': 'folder'
  id: string
  name: string
  path_display: string
  path_lower: string
}

export interface DropboxDeletedMetadata {
  '.tag': 'deleted'
  name: string
  path_display: string
  path_lower: string
}

export type DropboxMetadata = DropboxFileMetadata | DropboxFolderMetadata | DropboxDeletedMetadata

export interface DropboxSharedLinkMetadata {
  url: string
  name: string
  path_lower: string
  link_permissions: {
    can_revoke: boolean
    resolved_visibility: {
      '.tag': 'public' | 'team_only' | 'password' | 'team_and_password' | 'shared_folder_only'
    }
    revoke_failure_reason?: {
      '.tag': string
    }
  }
  expires?: string
  id?: string
}

export interface DropboxSearchMatch {
  match_type: {
    '.tag': 'filename' | 'content' | 'both'
  }
  metadata: {
    '.tag': 'metadata'
    metadata: DropboxMetadata
  }
}

// ===== Base Params =====

export interface DropboxBaseParams {
  accessToken?: string
}

// ===== Upload Params =====

export interface DropboxUploadParams extends DropboxBaseParams {
  path: string
  file?: UserFileLike
  // Legacy field for backwards compatibility
  fileContent?: string
  fileName?: string
  mode?: 'add' | 'overwrite'
  autorename?: boolean
  mute?: boolean
}

export interface DropboxUploadResponse extends ToolResponse {
  output: {
    file?: DropboxFileMetadata
  }
}

// ===== Download Params =====

export interface DropboxDownloadParams extends DropboxBaseParams {
  path: string
}

export interface DropboxDownloadResponse extends ToolResponse {
  output: {
    file?: ToolFileData
    content?: string // Base64 encoded file content
    metadata?: DropboxFileMetadata
    temporaryLink?: string
  }
}

// ===== List Folder Params =====

export interface DropboxListFolderParams extends DropboxBaseParams {
  path: string
  recursive?: boolean
  includeDeleted?: boolean
  includeMediaInfo?: boolean
  limit?: number
}

export interface DropboxListFolderResponse extends ToolResponse {
  output: {
    entries?: DropboxMetadata[]
    cursor?: string
    hasMore?: boolean
  }
}

// ===== Create Folder Params =====

export interface DropboxCreateFolderParams extends DropboxBaseParams {
  path: string
  autorename?: boolean
}

export interface DropboxCreateFolderResponse extends ToolResponse {
  output: {
    folder?: DropboxFolderMetadata
  }
}

// ===== Delete Params =====

export interface DropboxDeleteParams extends DropboxBaseParams {
  path: string
}

export interface DropboxDeleteResponse extends ToolResponse {
  output: {
    metadata?: DropboxMetadata
    deleted?: boolean
  }
}

// ===== Copy Params =====

export interface DropboxCopyParams extends DropboxBaseParams {
  fromPath: string
  toPath: string
  autorename?: boolean
}

export interface DropboxCopyResponse extends ToolResponse {
  output: {
    metadata?: DropboxMetadata
  }
}

// ===== Move Params =====

export interface DropboxMoveParams extends DropboxBaseParams {
  fromPath: string
  toPath: string
  autorename?: boolean
}

export interface DropboxMoveResponse extends ToolResponse {
  output: {
    metadata?: DropboxMetadata
  }
}

// ===== Get Metadata Params =====

export interface DropboxGetMetadataParams extends DropboxBaseParams {
  path: string
  includeMediaInfo?: boolean
  includeDeleted?: boolean
}

export interface DropboxGetMetadataResponse extends ToolResponse {
  output: {
    metadata?: DropboxMetadata
  }
}

// ===== Create Shared Link Params =====

export interface DropboxCreateSharedLinkParams extends DropboxBaseParams {
  path: string
  requestedVisibility?: 'public' | 'team_only' | 'password'
  linkPassword?: string
  expires?: string
}

export interface DropboxCreateSharedLinkResponse extends ToolResponse {
  output: {
    sharedLink?: DropboxSharedLinkMetadata
  }
}

// ===== Search Params =====

export interface DropboxSearchParams extends DropboxBaseParams {
  query: string
  path?: string
  fileExtensions?: string
  maxResults?: number
}

export interface DropboxSearchResponse extends ToolResponse {
  output: {
    matches?: DropboxSearchMatch[]
    hasMore?: boolean
    cursor?: string
  }
}

// ===== Get Temporary Link Params =====

export interface DropboxGetTemporaryLinkParams extends DropboxBaseParams {
  path: string
}

export interface DropboxGetTemporaryLinkResponse extends ToolResponse {
  output: {
    metadata?: DropboxFileMetadata
    link?: string
  }
}

// ===== Combined Response Type =====

export type DropboxResponse =
  | DropboxUploadResponse
  | DropboxDownloadResponse
  | DropboxListFolderResponse
  | DropboxCreateFolderResponse
  | DropboxDeleteResponse
  | DropboxCopyResponse
  | DropboxMoveResponse
  | DropboxGetMetadataResponse
  | DropboxCreateSharedLinkResponse
  | DropboxSearchResponse
  | DropboxGetTemporaryLinkResponse
