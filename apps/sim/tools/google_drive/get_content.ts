import { createLogger } from '@sim/logger'
import type {
  GoogleDriveFile,
  GoogleDriveGetContentResponse,
  GoogleDriveRevision,
  GoogleDriveToolParams,
} from '@/tools/google_drive/types'
import { DEFAULT_EXPORT_FORMATS, GOOGLE_WORKSPACE_MIME_TYPES } from '@/tools/google_drive/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleDriveGetContentTool')

// All available file metadata fields from Google Drive API v3
const ALL_FILE_FIELDS = [
  // Basic Info
  'id',
  'name',
  'mimeType',
  'kind',
  'description',
  'originalFilename',
  'fullFileExtension',
  'fileExtension',
  // Ownership & Sharing
  'owners',
  'permissions',
  'permissionIds',
  'shared',
  'ownedByMe',
  'writersCanShare',
  'viewersCanCopyContent',
  'copyRequiresWriterPermission',
  'sharingUser',
  // Labels/Tags
  'starred',
  'trashed',
  'explicitlyTrashed',
  'properties',
  'appProperties',
  'folderColorRgb',
  // Timestamps
  'createdTime',
  'modifiedTime',
  'modifiedByMeTime',
  'viewedByMeTime',
  'sharedWithMeTime',
  'trashedTime',
  // User Info
  'lastModifyingUser',
  'trashingUser',
  'viewedByMe',
  'modifiedByMe',
  // Links
  'webViewLink',
  'webContentLink',
  'iconLink',
  'thumbnailLink',
  'exportLinks',
  // Size & Storage
  'size',
  'quotaBytesUsed',
  // Checksums
  'md5Checksum',
  'sha1Checksum',
  'sha256Checksum',
  // Hierarchy & Location
  'parents',
  'spaces',
  'driveId',
  'teamDriveId',
  // Capabilities
  'capabilities',
  // Versions
  'version',
  'headRevisionId',
  // Media Metadata
  'hasThumbnail',
  'thumbnailVersion',
  'imageMediaMetadata',
  'videoMediaMetadata',
  'contentHints',
  // Other
  'isAppAuthorized',
  'contentRestrictions',
  'resourceKey',
  'shortcutDetails',
  'linkShareMetadata',
].join(',')

// All revision fields
const ALL_REVISION_FIELDS = [
  'id',
  'mimeType',
  'modifiedTime',
  'keepForever',
  'published',
  'publishAuto',
  'publishedLink',
  'publishedOutsideDomain',
  'lastModifyingUser',
  'originalFilename',
  'md5Checksum',
  'size',
  'exportLinks',
  'kind',
].join(',')

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
      visibility: 'user-only',
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
      description: 'Whether to include revision history in the metadata (default: true)',
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

      // Fetch revisions if requested (default: true)
      const includeRevisions = params?.includeRevisions !== false
      if (includeRevisions) {
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
      type: 'json',
      description:
        'Complete file metadata including ownership, sharing, permissions, labels, checksums, capabilities, and revision history',
    },
  },
}
