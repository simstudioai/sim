import type { GoogleDriveListResponse, GoogleDriveToolParams } from '@/tools/google_drive/types'
import type { ToolConfig } from '@/tools/types'

// All available file metadata fields from Google Drive API v3
// Note: For list operations, some nested fields may not be available depending on permissions
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
      visibility: 'user-only',
      description: 'Select the folder to list files from',
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

      // Build the query conditions
      const conditions = ['trashed = false'] // Always exclude trashed files
      const folderId = params.folderId || params.folderSelector
      if (folderId) {
        conditions.push(`'${folderId}' in parents`)
      }

      // Combine all conditions with AND
      url.searchParams.append('q', conditions.join(' and '))

      if (params.query) {
        const existingQ = url.searchParams.get('q')
        const queryPart = `name contains '${params.query}'`
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
      type: 'json',
      description:
        'Array of file metadata objects with complete ownership, sharing, permissions, labels, checksums, and capabilities',
    },
  },
}
