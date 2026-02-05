import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

// User information returned in various file metadata fields
export interface GoogleDriveUser {
  displayName?: string
  emailAddress?: string
  photoLink?: string
  permissionId?: string
  kind?: string
  me?: boolean
}

// Permission details for a file
export interface GoogleDrivePermission {
  id?: string
  type?: string // 'user' | 'group' | 'domain' | 'anyone'
  role?: string // 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader'
  emailAddress?: string
  displayName?: string
  photoLink?: string
  domain?: string
  expirationTime?: string
  deleted?: boolean
  allowFileDiscovery?: boolean
  pendingOwner?: boolean
  permissionDetails?: Array<{
    permissionType?: string
    role?: string
    inheritedFrom?: string
    inherited?: boolean
  }>
}

// Label/tag information
export interface GoogleDriveLabel {
  id?: string
  revisionId?: string
  kind?: string
  fields?: Record<
    string,
    {
      kind?: string
      id?: string
      valueType?: string
      dateString?: string[]
      integer?: string[]
      selection?: string[]
      text?: string[]
      user?: GoogleDriveUser[]
    }
  >
}

// Content hints for indexing
export interface GoogleDriveContentHints {
  indexableText?: string
  thumbnail?: {
    image?: string
    mimeType?: string
  }
}

// Image-specific metadata
export interface GoogleDriveImageMediaMetadata {
  width?: number
  height?: number
  rotation?: number
  time?: string
  cameraMake?: string
  cameraModel?: string
  exposureTime?: number
  aperture?: number
  flashUsed?: boolean
  focalLength?: number
  isoSpeed?: number
  meteringMode?: string
  sensor?: string
  exposureMode?: string
  colorSpace?: string
  whiteBalance?: string
  exposureBias?: number
  maxApertureValue?: number
  subjectDistance?: number
  lens?: string
  location?: {
    latitude?: number
    longitude?: number
    altitude?: number
  }
}

// Video-specific metadata
export interface GoogleDriveVideoMediaMetadata {
  width?: number
  height?: number
  durationMillis?: string
}

// Shortcut details
export interface GoogleDriveShortcutDetails {
  targetId?: string
  targetMimeType?: string
  targetResourceKey?: string
}

// Content restrictions
export interface GoogleDriveContentRestriction {
  readOnly?: boolean
  reason?: string
  type?: string
  restrictingUser?: GoogleDriveUser
  restrictionTime?: string
  ownerRestricted?: boolean
  systemRestricted?: boolean
}

// Link share metadata
export interface GoogleDriveLinkShareMetadata {
  securityUpdateEligible?: boolean
  securityUpdateEnabled?: boolean
}

// Capabilities - what the current user can do with the file
export interface GoogleDriveCapabilities {
  canAcceptOwnership?: boolean
  canAddChildren?: boolean
  canAddFolderFromAnotherDrive?: boolean
  canAddMyDriveParent?: boolean
  canChangeCopyRequiresWriterPermission?: boolean
  canChangeSecurityUpdateEnabled?: boolean
  canChangeViewersCanCopyContent?: boolean
  canComment?: boolean
  canCopy?: boolean
  canDelete?: boolean
  canDeleteChildren?: boolean
  canDownload?: boolean
  canEdit?: boolean
  canListChildren?: boolean
  canModifyContent?: boolean
  canModifyContentRestriction?: boolean
  canModifyEditorContentRestriction?: boolean
  canModifyLabels?: boolean
  canModifyOwnerContentRestriction?: boolean
  canMoveChildrenOutOfDrive?: boolean
  canMoveChildrenOutOfTeamDrive?: boolean
  canMoveChildrenWithinDrive?: boolean
  canMoveChildrenWithinTeamDrive?: boolean
  canMoveItemIntoTeamDrive?: boolean
  canMoveItemOutOfDrive?: boolean
  canMoveItemOutOfTeamDrive?: boolean
  canMoveItemWithinDrive?: boolean
  canMoveItemWithinTeamDrive?: boolean
  canMoveTeamDriveItem?: boolean
  canReadDrive?: boolean
  canReadLabels?: boolean
  canReadRevisions?: boolean
  canReadTeamDrive?: boolean
  canRemoveChildren?: boolean
  canRemoveContentRestriction?: boolean
  canRemoveMyDriveParent?: boolean
  canRename?: boolean
  canShare?: boolean
  canTrash?: boolean
  canTrashChildren?: boolean
  canUntrash?: boolean
}

// Revision information
export interface GoogleDriveRevision {
  id?: string
  mimeType?: string
  modifiedTime?: string
  keepForever?: boolean
  published?: boolean
  publishAuto?: boolean
  publishedLink?: string
  publishedOutsideDomain?: boolean
  lastModifyingUser?: GoogleDriveUser
  originalFilename?: string
  md5Checksum?: string
  size?: string
  exportLinks?: Record<string, string>
  kind?: string
}

// Complete file metadata - all 50+ fields from Google Drive API v3
export interface GoogleDriveFile {
  // Basic Info
  id: string
  name: string
  mimeType: string
  kind?: string
  description?: string
  originalFilename?: string
  fullFileExtension?: string
  fileExtension?: string

  // Ownership & Sharing
  owners?: GoogleDriveUser[]
  permissions?: GoogleDrivePermission[]
  permissionIds?: string[]
  shared?: boolean
  ownedByMe?: boolean
  writersCanShare?: boolean
  viewersCanCopyContent?: boolean
  copyRequiresWriterPermission?: boolean
  sharingUser?: GoogleDriveUser

  // Labels/Tags
  labels?: GoogleDriveLabel[]
  labelInfo?: {
    labels?: GoogleDriveLabel[]
  }
  starred?: boolean
  trashed?: boolean
  explicitlyTrashed?: boolean
  properties?: Record<string, string>
  appProperties?: Record<string, string>
  folderColorRgb?: string

  // Timestamps
  createdTime?: string
  modifiedTime?: string
  modifiedByMeTime?: string
  viewedByMeTime?: string
  sharedWithMeTime?: string
  trashedTime?: string

  // User Info
  lastModifyingUser?: GoogleDriveUser
  trashingUser?: GoogleDriveUser
  viewedByMe?: boolean
  modifiedByMe?: boolean

  // Links
  webViewLink?: string
  webContentLink?: string
  iconLink?: string
  thumbnailLink?: string
  exportLinks?: Record<string, string>

  // Size & Storage
  size?: string
  quotaBytesUsed?: string

  // Checksums
  md5Checksum?: string
  sha1Checksum?: string
  sha256Checksum?: string

  // Hierarchy & Location
  parents?: string[]
  spaces?: string[]
  driveId?: string
  teamDriveId?: string

  // Capabilities
  capabilities?: GoogleDriveCapabilities

  // Versions
  version?: string
  headRevisionId?: string

  // Media Metadata
  hasThumbnail?: boolean
  thumbnailVersion?: string
  imageMediaMetadata?: GoogleDriveImageMediaMetadata
  videoMediaMetadata?: GoogleDriveVideoMediaMetadata
  contentHints?: GoogleDriveContentHints

  // Other
  isAppAuthorized?: boolean
  contentRestrictions?: GoogleDriveContentRestriction[]
  resourceKey?: string
  shortcutDetails?: GoogleDriveShortcutDetails
  linkShareMetadata?: GoogleDriveLinkShareMetadata
  hasAugmentedPermissions?: boolean
  inheritedPermissionsDisabled?: boolean
  downloadRestrictions?: {
    restrictedForReaders?: boolean
  }

  // Revisions (fetched separately but included in response)
  revisions?: GoogleDriveRevision[]
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

export interface GoogleDriveDownloadResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: string
      size: number
    }
    metadata: GoogleDriveFile
  }
}

export interface GoogleDriveToolParams {
  accessToken: string
  folderId?: string
  folderSelector?: string
  fileId?: string
  fileName?: string
  file?: UserFile
  content?: string
  mimeType?: string
  query?: string
  pageSize?: number
  pageToken?: string
  exportMimeType?: string
  includeRevisions?: boolean
}

export type GoogleDriveResponse =
  | GoogleDriveUploadResponse
  | GoogleDriveGetContentResponse
  | GoogleDriveDownloadResponse
  | GoogleDriveListResponse
