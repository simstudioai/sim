import { createLogger } from '@sim/logger'
import type { GoogleDriveToolParams, GoogleDriveUploadResponse } from '@/tools/google_drive/types'
import {
  ALL_FILE_FIELDS,
  GOOGLE_WORKSPACE_MIME_TYPES,
  handleSheetsFormat,
  SOURCE_MIME_TYPES,
} from '@/tools/google_drive/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleDriveUploadTool')

export const uploadTool: ToolConfig<GoogleDriveToolParams, GoogleDriveUploadResponse> = {
  id: 'google_drive_upload',
  name: 'Upload to Google Drive',
  description: 'Upload a file to Google Drive with complete metadata returned',
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
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the file to upload',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Binary file to upload (UserFile object)',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text content to upload (use this OR file, not both)',
    },
    mimeType: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The MIME type of the file to upload (auto-detected from file if not provided)',
    },
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Google Drive folder ID to upload the file to (e.g., 1ABCxyz...)',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the folder to upload the file to (internal use)',
    },
  },

  request: {
    url: (params) => {
      // Use custom API route if file is provided, otherwise use Google Drive API directly
      if (params.file) {
        return '/api/tools/google_drive/upload'
      }
      return 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true'
    },
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      // Google Drive API for text-only uploads needs Authorization
      if (!params.file) {
        headers.Authorization = `Bearer ${params.accessToken}`
      }
      return headers
    },
    body: (params) => {
      // Custom route handles file uploads
      if (params.file) {
        return {
          accessToken: params.accessToken,
          fileName: params.fileName,
          file: params.file,
          mimeType: params.mimeType,
          folderId: params.folderSelector || params.folderId,
        }
      }

      // Original text-only upload logic
      const metadata: {
        name: string | undefined
        mimeType: string
        parents?: string[]
      } = {
        name: params.fileName, // Important: Always include the filename in metadata
        mimeType: params.mimeType || 'text/plain',
      }

      // Add parent folder if specified (prefer folderSelector over folderId)
      const parentFolderId = params.folderSelector || params.folderId
      if (parentFolderId && parentFolderId.trim() !== '') {
        metadata.parents = [parentFolderId]
      }

      return metadata
    },
  },

  transformResponse: async (response: Response, params?: GoogleDriveToolParams) => {
    try {
      const data = await response.json()

      // Handle custom API route response (for file uploads)
      if (params?.file && data.success !== undefined) {
        if (!data.success) {
          logger.error('Failed to upload file via custom API route', {
            error: data.error,
          })
          throw new Error(data.error || 'Failed to upload file to Google Drive')
        }
        return {
          success: true,
          output: {
            file: data.output.file,
          },
        }
      }

      // Handle Google Drive API response (for text-only uploads)
      if (!response.ok) {
        logger.error('Failed to create file in Google Drive', {
          status: response.status,
          statusText: response.statusText,
          data,
        })
        throw new Error(data.error?.message || 'Failed to create file in Google Drive')
      }

      const fileId = data.id
      const requestedMimeType = params?.mimeType || 'text/plain'
      const authHeader =
        response.headers.get('Authorization') || `Bearer ${params?.accessToken || ''}`

      let preparedContent: string | undefined =
        typeof params?.content === 'string' ? (params?.content as string) : undefined

      if (requestedMimeType === 'application/vnd.google-apps.spreadsheet' && params?.content) {
        const { csv, rowCount, columnCount } = handleSheetsFormat(params.content as unknown)
        if (csv !== undefined) {
          preparedContent = csv
          logger.info('Prepared CSV content for Google Sheets upload', {
            fileId,
            fileName: params?.fileName,
            rowCount,
            columnCount,
          })
        }
      }

      const uploadMimeType = GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)
        ? SOURCE_MIME_TYPES[requestedMimeType] || 'text/plain'
        : requestedMimeType

      logger.info('Uploading content to file', {
        fileId,
        fileName: params?.fileName,
        requestedMimeType,
        uploadMimeType,
      })

      const uploadResponse = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: {
            Authorization: authHeader,
            'Content-Type': uploadMimeType,
          },
          body: preparedContent !== undefined ? preparedContent : params?.content || '',
        }
      )

      if (!uploadResponse.ok) {
        const uploadError = await uploadResponse.json()
        logger.error('Failed to upload content to file', {
          status: uploadResponse.status,
          statusText: uploadResponse.statusText,
          error: uploadError,
        })
        throw new Error(uploadError.error?.message || 'Failed to upload content to file')
      }

      if (GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)) {
        logger.info('Updating file name to ensure it persists after conversion', {
          fileId,
          fileName: params?.fileName,
        })

        const updateNameResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
          {
            method: 'PATCH',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: params?.fileName,
            }),
          }
        )

        if (!updateNameResponse.ok) {
          logger.warn('Failed to update filename after conversion, but content was uploaded', {
            status: updateNameResponse.status,
            statusText: updateNameResponse.statusText,
          })
        }
      }

      // Fetch complete file metadata with all fields
      const finalFileResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=${ALL_FILE_FIELDS}`,
        {
          headers: {
            Authorization: authHeader,
          },
        }
      )

      const finalFile = await finalFileResponse.json()

      return {
        success: true,
        output: {
          file: finalFile,
        },
      }
    } catch (error: any) {
      logger.error('Error in upload transformation', {
        error: error.message,
        stack: error.stack,
      })
      throw error
    }
  },

  outputs: {
    file: {
      type: 'object',
      description: 'Complete uploaded file metadata from Google Drive',
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
      },
    },
  },
}
