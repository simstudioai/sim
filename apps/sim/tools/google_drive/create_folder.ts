import { createLogger } from '@sim/logger'
import type { GoogleDriveToolParams, GoogleDriveUploadResponse } from '@/tools/google_drive/types'
import { ALL_FILE_FIELDS } from '@/tools/google_drive/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleDriveCreateFolderTool')

export const createFolderTool: ToolConfig<GoogleDriveToolParams, GoogleDriveUploadResponse> = {
  id: 'google_drive_create_folder',
  name: 'Create Folder in Google Drive',
  description: 'Create a new folder in Google Drive with complete metadata returned',
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
      description: 'Name of the folder to create',
    },
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Google Drive parent folder ID to create the folder in (e.g., 1ABCxyz...)',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'ID of the parent folder (internal use)',
    },
  },

  request: {
    url: 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const metadata: {
        name: string | undefined
        mimeType: string
        parents?: string[]
      } = {
        name: params.fileName,
        mimeType: 'application/vnd.google-apps.folder',
      }

      // Add parent folder if specified (prefer folderSelector over folderId)
      const parentFolderId = params.folderSelector || params.folderId
      if (parentFolderId) {
        metadata.parents = [parentFolderId]
      }

      return metadata
    },
  },

  transformResponse: async (response: Response, params?: GoogleDriveToolParams) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      logger.error('Failed to create folder in Google Drive', {
        status: response.status,
        statusText: response.statusText,
        error: data,
      })
      throw new Error(data.error?.message || 'Failed to create folder in Google Drive')
    }

    const data = await response.json()
    const folderId = data.id
    const authHeader = `Bearer ${params?.accessToken || ''}`

    // Fetch complete folder metadata with all fields
    const metadataResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?supportsAllDrives=true&fields=${ALL_FILE_FIELDS}`,
      {
        headers: {
          Authorization: authHeader,
        },
      }
    )

    if (!metadataResponse.ok) {
      logger.warn('Failed to fetch complete metadata, returning basic response', {
        status: metadataResponse.status,
        statusText: metadataResponse.statusText,
      })
      // Return basic response if metadata fetch fails
      return {
        success: true,
        output: {
          file: data,
        },
      }
    }

    const fullMetadata = await metadataResponse.json()

    logger.info('Folder created successfully', {
      folderId: fullMetadata.id,
      name: fullMetadata.name,
      mimeType: fullMetadata.mimeType,
      hasOwners: !!fullMetadata.owners?.length,
      hasPermissions: !!fullMetadata.permissions?.length,
    })

    return {
      success: true,
      output: {
        file: fullMetadata,
      },
    }
  },

  outputs: {
    file: {
      type: 'object',
      description: 'Complete created folder metadata from Google Drive',
      properties: {
        // Basic Info
        id: { type: 'string', description: 'Google Drive folder ID' },
        kind: { type: 'string', description: 'Resource type identifier' },
        name: { type: 'string', description: 'Folder name' },
        mimeType: { type: 'string', description: 'MIME type (application/vnd.google-apps.folder)' },
        description: { type: 'string', description: 'Folder description' },
        // Ownership & Sharing
        owners: { type: 'json', description: 'List of folder owners' },
        permissions: { type: 'json', description: 'Folder permissions' },
        permissionIds: { type: 'json', description: 'Permission IDs' },
        shared: { type: 'boolean', description: 'Whether folder is shared' },
        ownedByMe: { type: 'boolean', description: 'Whether owned by current user' },
        writersCanShare: { type: 'boolean', description: 'Whether writers can share' },
        viewersCanCopyContent: { type: 'boolean', description: 'Whether viewers can copy' },
        copyRequiresWriterPermission: {
          type: 'boolean',
          description: 'Whether copy requires writer permission',
        },
        sharingUser: { type: 'json', description: 'User who shared the folder' },
        // Labels/Tags
        starred: { type: 'boolean', description: 'Whether folder is starred' },
        trashed: { type: 'boolean', description: 'Whether folder is in trash' },
        explicitlyTrashed: { type: 'boolean', description: 'Whether explicitly trashed' },
        properties: { type: 'json', description: 'Custom properties' },
        appProperties: { type: 'json', description: 'App-specific properties' },
        folderColorRgb: { type: 'string', description: 'Folder color' },
        // Timestamps
        createdTime: { type: 'string', description: 'Folder creation time' },
        modifiedTime: { type: 'string', description: 'Last modification time' },
        modifiedByMeTime: { type: 'string', description: 'When modified by current user' },
        viewedByMeTime: { type: 'string', description: 'When last viewed by current user' },
        sharedWithMeTime: { type: 'string', description: 'When shared with current user' },
        // User Info
        lastModifyingUser: { type: 'json', description: 'User who last modified the folder' },
        viewedByMe: { type: 'boolean', description: 'Whether viewed by current user' },
        modifiedByMe: { type: 'boolean', description: 'Whether modified by current user' },
        // Links
        webViewLink: { type: 'string', description: 'URL to view in browser' },
        iconLink: { type: 'string', description: 'URL to folder icon' },
        // Hierarchy & Location
        parents: { type: 'json', description: 'Parent folder IDs' },
        spaces: { type: 'json', description: 'Spaces containing folder' },
        driveId: { type: 'string', description: 'Shared drive ID' },
        // Capabilities
        capabilities: { type: 'json', description: 'User capabilities on folder' },
        // Versions
        version: { type: 'string', description: 'Version number' },
        // Other
        isAppAuthorized: { type: 'boolean', description: 'Whether created by requesting app' },
        contentRestrictions: { type: 'json', description: 'Content restrictions' },
        linkShareMetadata: { type: 'json', description: 'Link share metadata' },
      },
    },
  },
}
