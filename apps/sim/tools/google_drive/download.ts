import type { GoogleDriveDownloadResponse, GoogleDriveToolParams } from '@/tools/google_drive/types'
import type { ToolConfig } from '@/tools/types'

export const downloadTool: ToolConfig<GoogleDriveToolParams, GoogleDriveDownloadResponse> = {
  id: 'google_drive_download',
  name: 'Download File from Google Drive',
  description:
    'Download a file from Google Drive with complete metadata (exports Google Workspace files automatically)',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-drive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Drive API',
    },
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file to download',
    },
    mimeType: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The MIME type to export Google Workspace files to (optional)',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional filename override',
    },
    includeRevisions: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to include revision history in the metadata (default: true, returns first 100 revisions)',
    },
  },

  request: {
    url: '/api/tools/google_drive/download',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      fileId: params.fileId,
      mimeType: params.mimeType,
      fileName: params.fileName,
      includeRevisions: params.includeRevisions,
    }),
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Downloaded file stored in execution files',
    },
    metadata: {
      type: 'object',
      description: 'Complete file metadata from Google Drive',
      properties: {
        // Basic Info
        id: { type: 'string', description: 'Google Drive file ID' },
        kind: { type: 'string', description: 'Resource type identifier' },
        name: { type: 'string', description: 'File name' },
        mimeType: { type: 'string', description: 'MIME type' },
        description: { type: 'string', description: 'File description' },
        originalFilename: { type: 'string', description: 'Original uploaded filename' },
        fullFileExtension: { type: 'string', description: 'Full file extension' },
        fileExtension: { type: 'string', description: 'File extension' },
        // Ownership & Sharing
        owners: { type: 'json', description: 'List of file owners' },
        permissions: { type: 'json', description: 'File permissions' },
        permissionIds: { type: 'json', description: 'Permission IDs' },
        shared: { type: 'boolean', description: 'Whether file is shared' },
        ownedByMe: { type: 'boolean', description: 'Whether owned by current user' },
        writersCanShare: { type: 'boolean', description: 'Whether writers can share' },
        viewersCanCopyContent: { type: 'boolean', description: 'Whether viewers can copy' },
        copyRequiresWriterPermission: {
          type: 'boolean',
          description: 'Whether copy requires writer permission',
        },
        sharingUser: { type: 'json', description: 'User who shared the file' },
        // Labels/Tags
        starred: { type: 'boolean', description: 'Whether file is starred' },
        trashed: { type: 'boolean', description: 'Whether file is in trash' },
        explicitlyTrashed: { type: 'boolean', description: 'Whether explicitly trashed' },
        properties: { type: 'json', description: 'Custom properties' },
        appProperties: { type: 'json', description: 'App-specific properties' },
        // Timestamps
        createdTime: { type: 'string', description: 'File creation time' },
        modifiedTime: { type: 'string', description: 'Last modification time' },
        modifiedByMeTime: { type: 'string', description: 'When modified by current user' },
        viewedByMeTime: { type: 'string', description: 'When last viewed by current user' },
        sharedWithMeTime: { type: 'string', description: 'When shared with current user' },
        // User Info
        lastModifyingUser: { type: 'json', description: 'User who last modified the file' },
        viewedByMe: { type: 'boolean', description: 'Whether viewed by current user' },
        modifiedByMe: { type: 'boolean', description: 'Whether modified by current user' },
        // Links
        webViewLink: { type: 'string', description: 'URL to view in browser' },
        webContentLink: { type: 'string', description: 'Direct download URL' },
        iconLink: { type: 'string', description: 'URL to file icon' },
        thumbnailLink: { type: 'string', description: 'URL to thumbnail' },
        exportLinks: { type: 'json', description: 'Export format links' },
        // Size & Storage
        size: { type: 'string', description: 'File size in bytes' },
        quotaBytesUsed: { type: 'string', description: 'Storage quota used' },
        // Checksums
        md5Checksum: { type: 'string', description: 'MD5 hash' },
        sha1Checksum: { type: 'string', description: 'SHA-1 hash' },
        sha256Checksum: { type: 'string', description: 'SHA-256 hash' },
        // Hierarchy & Location
        parents: { type: 'json', description: 'Parent folder IDs' },
        spaces: { type: 'json', description: 'Spaces containing file' },
        driveId: { type: 'string', description: 'Shared drive ID' },
        // Capabilities
        capabilities: { type: 'json', description: 'User capabilities on file' },
        // Versions
        version: { type: 'string', description: 'Version number' },
        headRevisionId: { type: 'string', description: 'Head revision ID' },
        // Media Metadata
        hasThumbnail: { type: 'boolean', description: 'Whether has thumbnail' },
        thumbnailVersion: { type: 'string', description: 'Thumbnail version' },
        imageMediaMetadata: { type: 'json', description: 'Image-specific metadata' },
        videoMediaMetadata: { type: 'json', description: 'Video-specific metadata' },
        // Other
        isAppAuthorized: { type: 'boolean', description: 'Whether created by requesting app' },
        contentRestrictions: { type: 'json', description: 'Content restrictions' },
        linkShareMetadata: { type: 'json', description: 'Link share metadata' },
        // Revisions
        revisions: {
          type: 'json',
          description: 'File revision history (first 100 revisions only)',
        },
      },
    },
  },
}
