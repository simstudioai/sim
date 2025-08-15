import type { OneDriveToolParams, OneDriveUploadResponse } from '@/tools/onedrive/types'
import type { ToolConfig } from '@/tools/types'

export const createFolderTool: ToolConfig<OneDriveToolParams, OneDriveUploadResponse> = {
  id: 'onedrive_create_folder',
  name: 'Create Folder in OneDrive',
  description: 'Create a new folder in OneDrive',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'onedrive',
    additionalScopes: [],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the OneDrive API',
    },
    folderName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the folder to create',
    },
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Select the parent folder to create the folder in',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'ID of the parent folder (internal use)',
    },
  },

  request: {
    url: (params) => {
      // Use specific parent folder URL if parentId is provided
      const parentFolderId = params.folderSelector || params.folderId
      if (parentFolderId) {
        return `https://graph.microsoft.com/v1.0/me/drive/items/${parentFolderId}/children`
      }
      return 'https://graph.microsoft.com/v1.0/me/drive/root/children'
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return {
        name: params.folderName,
        folder: {}, // Required facet for folder creation in Microsoft Graph API
        '@microsoft.graph.conflictBehavior': 'rename', // Handle name conflicts
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        file: {
          id: data.id,
          name: data.name,
          mimeType: 'application/vnd.microsoft.graph.folder',
          webViewLink: data.webUrl,
          size: data.size,
          createdTime: data.createdDateTime,
          modifiedTime: data.lastModifiedDateTime,
          parentReference: data.parentReference,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the folder was created successfully' },
    file: {
      type: 'object',
      description:
        'The created folder object with metadata including id, name, webViewLink, and timestamps',
    },
  },
}
