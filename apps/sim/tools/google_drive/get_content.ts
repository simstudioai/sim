import { createLogger } from '@sim/logger'
import type {
  GoogleDriveFile,
  GoogleDriveGetContentResponse,
  GoogleDriveRevision,
  GoogleDriveToolParams,
} from '@/tools/google_drive/types'
import {
  ALL_FILE_FIELDS,
  ALL_REVISION_FIELDS,
  DEFAULT_EXPORT_FORMATS,
  GOOGLE_WORKSPACE_MIME_TYPES,
} from '@/tools/google_drive/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleDriveGetContentTool')

export const getContentTool: ToolConfig<GoogleDriveToolParams, GoogleDriveGetContentResponse> = {
  id: 'google_drive_get_content',
  name: 'Get Content from Google Drive',
  description:
    'Get content from a file in Google Drive with complete metadata (exports Google Workspace files automatically)',
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
      description: 'The ID of the file to get content from',
    },
    mimeType: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The MIME type to export Google Workspace files to (optional)',
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
    url: (params) =>
      `https://www.googleapis.com/drive/v3/files/${params.fileId}?fields=${ALL_FILE_FIELDS}&supportsAllDrives=true`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response, params?: GoogleDriveToolParams) => {
    try {
      if (!response.ok) {
        const errorDetails = await response.json().catch(() => ({}))
        logger.error('Failed to get file metadata', {
          status: response.status,
          statusText: response.statusText,
          error: errorDetails,
        })
        throw new Error(errorDetails.error?.message || 'Failed to get file metadata')
      }

      const metadata: GoogleDriveFile = await response.json()
      const fileId = metadata.id
      const mimeType = metadata.mimeType
      const authHeader = `Bearer ${params?.accessToken || ''}`

      let content: string

      if (GOOGLE_WORKSPACE_MIME_TYPES.includes(mimeType)) {
        const exportFormat = params?.mimeType || DEFAULT_EXPORT_FORMATS[mimeType] || 'text/plain'
        logger.info('Exporting Google Workspace file', {
          fileId,
          mimeType,
          exportFormat,
        })

        const exportResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportFormat)}&supportsAllDrives=true`,
          {
            headers: {
              Authorization: authHeader,
            },
          }
        )

        if (!exportResponse.ok) {
          const exportError = await exportResponse.json().catch(() => ({}))
          logger.error('Failed to export file', {
            status: exportResponse.status,
            statusText: exportResponse.statusText,
            error: exportError,
          })
          throw new Error(exportError.error?.message || 'Failed to export Google Workspace file')
        }

        content = await exportResponse.text()
      } else {
        logger.info('Downloading regular file', {
          fileId,
          mimeType,
        })

        const downloadResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
          {
            headers: {
              Authorization: authHeader,
            },
          }
        )

        if (!downloadResponse.ok) {
          const downloadError = await downloadResponse.json().catch(() => ({}))
          logger.error('Failed to download file', {
            status: downloadResponse.status,
            statusText: downloadResponse.statusText,
            error: downloadError,
          })
          throw new Error(downloadError.error?.message || 'Failed to download file')
        }

        content = await downloadResponse.text()
      }

      const includeRevisions = params?.includeRevisions !== false
      const canReadRevisions = metadata.capabilities?.canReadRevisions === true
      if (includeRevisions && canReadRevisions) {
        try {
          const revisionsResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}/revisions?fields=revisions(${ALL_REVISION_FIELDS})&pageSize=100`,
            {
              headers: {
                Authorization: authHeader,
              },
            }
          )

          if (revisionsResponse.ok) {
            const revisionsData = await revisionsResponse.json()
            metadata.revisions = revisionsData.revisions as GoogleDriveRevision[]
            logger.info('Fetched file revisions', {
              fileId,
              revisionCount: metadata.revisions?.length || 0,
            })
          } else {
            logger.warn('Failed to fetch revisions, continuing without them', {
              status: revisionsResponse.status,
              statusText: revisionsResponse.statusText,
            })
          }
        } catch (revisionError: any) {
          logger.warn('Error fetching revisions, continuing without them', {
            error: revisionError.message,
          })
        }
      } else if (includeRevisions && !canReadRevisions) {
        logger.info('Skipping revision fetch - user does not have canReadRevisions permission', {
          fileId,
        })
      }

      logger.info('File content retrieved successfully', {
        fileId,
        name: metadata.name,
        mimeType: metadata.mimeType,
        contentLength: content.length,
        hasOwners: !!metadata.owners?.length,
        hasPermissions: !!metadata.permissions?.length,
        hasRevisions: !!metadata.revisions?.length,
      })

      return {
        success: true,
        output: {
          content,
          metadata,
        },
      }
    } catch (error: any) {
      logger.error('Error in transform response', {
        error: error.message,
        stack: error.stack,
      })
      throw error
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'File content as text (Google Workspace files are exported)',
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
