import type { GoogleDriveListResponse, GoogleDriveToolParams } from '@/tools/google_drive/types'
import { ALL_FILE_FIELDS } from '@/tools/google_drive/utils'
import type { ToolConfig } from '@/tools/types'

export const listTool: ToolConfig<GoogleDriveToolParams, GoogleDriveListResponse> = {
  id: 'google_drive_list',
  name: 'List Google Drive Files',
  description: 'List files and folders in Google Drive with complete metadata',
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
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Google Drive folder ID to list files from (e.g., 1ABCxyz...)',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the folder to list files from (internal use)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search term to filter files by name (e.g. "budget" finds files with "budget" in the name). Do NOT use Google Drive query syntax here - just provide a plain search term.',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The maximum number of files to return (default: 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The page token to use for pagination',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://www.googleapis.com/drive/v3/files')
      url.searchParams.append('fields', `files(${ALL_FILE_FIELDS}),nextPageToken`)
      // Ensure shared drives support - corpora=allDrives is critical for searching across shared drives
      url.searchParams.append('corpora', 'allDrives')
      url.searchParams.append('supportsAllDrives', 'true')
      url.searchParams.append('includeItemsFromAllDrives', 'true')

      // Helper to escape single quotes for Google Drive query syntax
      const escapeQueryValue = (value: string): string =>
        value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

      // Build the query conditions
      const conditions = ['trashed = false'] // Always exclude trashed files
      const folderId = params.folderId || params.folderSelector
      if (folderId) {
        const escapedFolderId = escapeQueryValue(folderId)
        conditions.push(`'${escapedFolderId}' in parents`)
      }

      // Combine all conditions with AND
      url.searchParams.append('q', conditions.join(' and '))

      if (params.query) {
        const existingQ = url.searchParams.get('q')
        const escapedQuery = escapeQueryValue(params.query)
        const queryPart = `name contains '${escapedQuery}'`
        url.searchParams.set('q', `${existingQ} and ${queryPart}`)
      }
      if (params.pageSize) {
        url.searchParams.append('pageSize', Number(params.pageSize).toString())
      }
      if (params.pageToken) {
        url.searchParams.append('pageToken', params.pageToken)
      }

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to list Google Drive files')
    }

    return {
      success: true,
      output: {
        files: data.files,
        nextPageToken: data.nextPageToken,
      },
    }
  },

  outputs: {
    files: {
      type: 'array',
      description: 'Array of file metadata objects from Google Drive',
      items: {
        type: 'object',
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
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
    },
  },
}
