import type { ToolResponse } from '@/tools/types'

// ===== Core Types =====

export interface BoxFile {
  id: string
  type: 'file'
  name: string
  size?: number
  created_at?: string
  modified_at?: string
  content_created_at?: string
  content_modified_at?: string
  created_by?: BoxUser
  modified_by?: BoxUser
  owned_by?: BoxUser
  shared_link?: BoxSharedLink | null
  parent?: BoxFolder
  path_collection?: {
    total_count: number
    entries: BoxFolder[]
  }
  description?: string
  sha1?: string
  file_version?: {
    id: string
    type: 'file_version'
    sha1: string
  }
  etag?: string
  sequence_id?: string
}

export interface BoxFolder {
  id: string
  type: 'folder'
  name: string
  size?: number
  created_at?: string
  modified_at?: string
  created_by?: BoxUser
  modified_by?: BoxUser
  owned_by?: BoxUser
  shared_link?: BoxSharedLink | null
  parent?: BoxFolder | null
  path_collection?: {
    total_count: number
    entries: BoxFolder[]
  }
  description?: string
  item_collection?: {
    total_count: number
    entries: (BoxFile | BoxFolder)[]
    offset: number
    limit: number
  }
  etag?: string
  sequence_id?: string
}

export interface BoxUser {
  id: string
  type: 'user'
  name: string
  login?: string
  avatar_url?: string
}

export interface BoxSharedLink {
  url: string
  download_url?: string
  vanity_url?: string
  vanity_name?: string
  access: 'open' | 'company' | 'collaborators'
  effective_access?: 'open' | 'company' | 'collaborators'
  effective_permission?: 'can_download' | 'can_preview'
  unshared_at?: string
  is_password_enabled?: boolean
  permissions?: {
    can_download: boolean
    can_preview: boolean
  }
  download_count?: number
  preview_count?: number
}

export interface BoxCollaboration {
  id: string
  type: 'collaboration'
  role: 'editor' | 'viewer' | 'previewer' | 'uploader' | 'co-owner' | 'owner'
  status: 'accepted' | 'pending' | 'rejected'
  created_at?: string
  modified_at?: string
  accessible_by?: BoxUser | BoxGroup
  created_by?: BoxUser
  invite_email?: string
  item?: BoxFile | BoxFolder
}

export interface BoxGroup {
  id: string
  type: 'group'
  name: string
  description?: string
}

export interface BoxComment {
  id: string
  type: 'comment'
  message: string
  created_at: string
  modified_at?: string
  created_by: BoxUser
  item?: BoxFile
}

export interface BoxTask {
  id: string
  type: 'task'
  message?: string
  due_at?: string
  created_at: string
  completion_rule?: 'all_assignees' | 'any_assignee'
  action?: 'review' | 'complete'
  item?: BoxFile
  task_assignment_collection?: {
    total_count: number
    entries: BoxTaskAssignment[]
  }
}

export interface BoxTaskAssignment {
  id: string
  type: 'task_assignment'
  status?: 'incomplete' | 'approved' | 'rejected' | 'completed'
  message?: string
  assigned_to?: BoxUser
  assigned_at?: string
  completed_at?: string
}

export interface BoxFileVersion {
  id: string
  type: 'file_version'
  sha1: string
  name: string
  size: number
  created_at: string
  modified_at: string
  modified_by: BoxUser
  trashed_at?: string
  trashed_by?: BoxUser
  purged_at?: string
}

export interface BoxSearchResult {
  id: string
  type: 'file' | 'folder' | 'web_link'
  name: string
  parent?: BoxFolder
  modified_at?: string
  size?: number
}

// ===== Request Params =====

export interface BoxBaseParams {
  accessToken?: string
}

// File Operations
export interface BoxGetFileParams extends BoxBaseParams {
  fileId: string
  fields?: string
}

export interface BoxUploadFileParams extends BoxBaseParams {
  parentFolderId: string
  fileName: string
  fileContent: string
}

export interface BoxDownloadFileParams extends BoxBaseParams {
  fileId: string
}

export interface BoxUpdateFileParams extends BoxBaseParams {
  fileId: string
  name?: string
  description?: string
  parentId?: string
  tags?: string[]
}

export interface BoxCopyFileParams extends BoxBaseParams {
  fileId: string
  parentFolderId: string
  newName?: string
}

export interface BoxDeleteFileParams extends BoxBaseParams {
  fileId: string
  permanent?: boolean
}

export interface BoxRestoreFileParams extends BoxBaseParams {
  fileId: string
  newName?: string
  parentFolderId?: string
}

// Folder Operations
export interface BoxGetFolderParams extends BoxBaseParams {
  folderId: string
  fields?: string
}

export interface BoxListFolderItemsParams extends BoxBaseParams {
  folderId: string
  limit?: number
  offset?: number
  fields?: string
}

export interface BoxCreateFolderParams extends BoxBaseParams {
  parentFolderId: string
  folderName: string
}

export interface BoxUpdateFolderParams extends BoxBaseParams {
  folderId: string
  name?: string
  description?: string
  parentId?: string
}

export interface BoxCopyFolderParams extends BoxBaseParams {
  folderId: string
  parentFolderId: string
  newName?: string
}

export interface BoxDeleteFolderParams extends BoxBaseParams {
  folderId: string
  recursive?: boolean
}

// Search Operations
export interface BoxSearchParams extends BoxBaseParams {
  query: string
  scope?: 'user_content' | 'enterprise_content'
  fileExtensions?: string
  ancestorFolderIds?: string
  limit?: number
  offset?: number
  contentTypes?: string
}

// Collaboration Operations
export interface BoxCreateCollaborationParams extends BoxBaseParams {
  itemId: string
  itemType: 'file' | 'folder'
  accessibleByLogin?: string
  accessibleById?: string
  accessibleByType: 'user' | 'group'
  role: 'editor' | 'viewer' | 'previewer' | 'uploader' | 'co-owner'
  canViewPath?: boolean
}

export interface BoxListCollaborationsParams extends BoxBaseParams {
  itemId: string
  itemType: 'file' | 'folder'
  limit?: number
  offset?: number
}

export interface BoxUpdateCollaborationParams extends BoxBaseParams {
  collaborationId: string
  role: 'editor' | 'viewer' | 'previewer' | 'uploader' | 'co-owner'
  status?: 'accepted' | 'pending' | 'rejected'
}

export interface BoxDeleteCollaborationParams extends BoxBaseParams {
  collaborationId: string
}

// Shared Link Operations
export interface BoxCreateSharedLinkParams extends BoxBaseParams {
  itemId: string
  itemType: 'file' | 'folder'
  access?: 'open' | 'company' | 'collaborators'
  password?: string
  unsharedAt?: string
  canDownload?: boolean
  canPreview?: boolean
}

export interface BoxGetSharedLinkParams extends BoxBaseParams {
  itemId: string
  itemType: 'file' | 'folder'
}

export interface BoxDeleteSharedLinkParams extends BoxBaseParams {
  itemId: string
  itemType: 'file' | 'folder'
}

// Comment Operations
export interface BoxCreateCommentParams extends BoxBaseParams {
  fileId: string
  message: string
}

export interface BoxListCommentsParams extends BoxBaseParams {
  fileId: string
  limit?: number
  offset?: number
}

export interface BoxUpdateCommentParams extends BoxBaseParams {
  commentId: string
  message: string
}

export interface BoxDeleteCommentParams extends BoxBaseParams {
  commentId: string
}

// Task Operations
export interface BoxCreateTaskParams extends BoxBaseParams {
  fileId: string
  message?: string
  dueAt?: string
  action?: 'review' | 'complete'
}

export interface BoxGetTaskParams extends BoxBaseParams {
  taskId: string
}

export interface BoxUpdateTaskParams extends BoxBaseParams {
  taskId: string
  message?: string
  dueAt?: string
}

export interface BoxDeleteTaskParams extends BoxBaseParams {
  taskId: string
}

// File Version Operations
export interface BoxListFileVersionsParams extends BoxBaseParams {
  fileId: string
  limit?: number
  offset?: number
}

export interface BoxPromoteFileVersionParams extends BoxBaseParams {
  fileId: string
  versionId: string
}

// User Operations
export interface BoxGetCurrentUserParams extends BoxBaseParams {}

// ===== Response Types =====

export interface BoxGetFileResponse extends ToolResponse {
  output: {
    file?: BoxFile
  }
}

export interface BoxUploadFileResponse extends ToolResponse {
  output: {
    file?: BoxFile
  }
}

export interface BoxDownloadFileResponse extends ToolResponse {
  output: {
    content?: string
    fileName?: string
    mimeType?: string
  }
}

export interface BoxUpdateFileResponse extends ToolResponse {
  output: {
    file?: BoxFile
  }
}

export interface BoxCopyFileResponse extends ToolResponse {
  output: {
    file?: BoxFile
  }
}

export interface BoxDeleteFileResponse extends ToolResponse {
  output: {
    success?: boolean
    fileId?: string
  }
}

export interface BoxRestoreFileResponse extends ToolResponse {
  output: {
    file?: BoxFile
  }
}

export interface BoxGetFolderResponse extends ToolResponse {
  output: {
    folder?: BoxFolder
  }
}

export interface BoxListFolderItemsResponse extends ToolResponse {
  output: {
    items?: (BoxFile | BoxFolder)[]
    totalCount?: number
    offset?: number
    limit?: number
  }
}

export interface BoxCreateFolderResponse extends ToolResponse {
  output: {
    folder?: BoxFolder
  }
}

export interface BoxUpdateFolderResponse extends ToolResponse {
  output: {
    folder?: BoxFolder
  }
}

export interface BoxCopyFolderResponse extends ToolResponse {
  output: {
    folder?: BoxFolder
  }
}

export interface BoxDeleteFolderResponse extends ToolResponse {
  output: {
    success?: boolean
    folderId?: string
  }
}

export interface BoxSearchResponse extends ToolResponse {
  output: {
    results?: BoxSearchResult[]
    totalCount?: number
    offset?: number
    limit?: number
  }
}

export interface BoxCreateCollaborationResponse extends ToolResponse {
  output: {
    collaboration?: BoxCollaboration
  }
}

export interface BoxListCollaborationsResponse extends ToolResponse {
  output: {
    collaborations?: BoxCollaboration[]
    totalCount?: number
  }
}

export interface BoxUpdateCollaborationResponse extends ToolResponse {
  output: {
    collaboration?: BoxCollaboration
  }
}

export interface BoxDeleteCollaborationResponse extends ToolResponse {
  output: {
    success?: boolean
    collaborationId?: string
  }
}

export interface BoxCreateSharedLinkResponse extends ToolResponse {
  output: {
    sharedLink?: BoxSharedLink
    itemId?: string
    itemType?: string
  }
}

export interface BoxGetSharedLinkResponse extends ToolResponse {
  output: {
    sharedLink?: BoxSharedLink | null
    itemId?: string
    itemType?: string
  }
}

export interface BoxDeleteSharedLinkResponse extends ToolResponse {
  output: {
    success?: boolean
    itemId?: string
    itemType?: string
  }
}

export interface BoxCreateCommentResponse extends ToolResponse {
  output: {
    comment?: BoxComment
  }
}

export interface BoxListCommentsResponse extends ToolResponse {
  output: {
    comments?: BoxComment[]
    totalCount?: number
  }
}

export interface BoxUpdateCommentResponse extends ToolResponse {
  output: {
    comment?: BoxComment
  }
}

export interface BoxDeleteCommentResponse extends ToolResponse {
  output: {
    success?: boolean
    commentId?: string
  }
}

export interface BoxCreateTaskResponse extends ToolResponse {
  output: {
    task?: BoxTask
  }
}

export interface BoxGetTaskResponse extends ToolResponse {
  output: {
    task?: BoxTask
  }
}

export interface BoxUpdateTaskResponse extends ToolResponse {
  output: {
    task?: BoxTask
  }
}

export interface BoxDeleteTaskResponse extends ToolResponse {
  output: {
    success?: boolean
    taskId?: string
  }
}

export interface BoxListFileVersionsResponse extends ToolResponse {
  output: {
    versions?: BoxFileVersion[]
    totalCount?: number
  }
}

export interface BoxPromoteFileVersionResponse extends ToolResponse {
  output: {
    file?: BoxFile
  }
}

export interface BoxGetCurrentUserResponse extends ToolResponse {
  output: {
    user?: BoxUser & {
      space_used?: number
      space_amount?: number
      max_upload_size?: number
    }
  }
}

// Union type for all Box responses
export type BoxResponse =
  | BoxGetFileResponse
  | BoxUploadFileResponse
  | BoxDownloadFileResponse
  | BoxUpdateFileResponse
  | BoxCopyFileResponse
  | BoxDeleteFileResponse
  | BoxRestoreFileResponse
  | BoxGetFolderResponse
  | BoxListFolderItemsResponse
  | BoxCreateFolderResponse
  | BoxUpdateFolderResponse
  | BoxCopyFolderResponse
  | BoxDeleteFolderResponse
  | BoxSearchResponse
  | BoxCreateCollaborationResponse
  | BoxListCollaborationsResponse
  | BoxUpdateCollaborationResponse
  | BoxDeleteCollaborationResponse
  | BoxCreateSharedLinkResponse
  | BoxGetSharedLinkResponse
  | BoxDeleteSharedLinkResponse
  | BoxCreateCommentResponse
  | BoxListCommentsResponse
  | BoxUpdateCommentResponse
  | BoxDeleteCommentResponse
  | BoxCreateTaskResponse
  | BoxGetTaskResponse
  | BoxUpdateTaskResponse
  | BoxDeleteTaskResponse
  | BoxListFileVersionsResponse
  | BoxPromoteFileVersionResponse
  | BoxGetCurrentUserResponse
