import type { OneDriveToolParams, OneDriveUploadResponse } from '@/tools/onedrive/types'
import { driveItemDetails } from '@/tools/onedrive/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const createFolderTool: ToolConfig<OneDriveToolParams, OneDriveUploadResponse> = {
  id: 'onedrive_create_folder',
  name: 'Create Folder in OneDrive',
  description: 'Create a new folder in OneDrive',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'onedrive',
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
      description: 'Name of the folder to create (e.g., "My Documents", "Project Files")',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Parent folder ID to create the folder in (e.g., "01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36M")',
    },
  },

  request: {
    url: (params) => {
      const parentFolderId = params.folderId?.trim()
      if (parentFolderId) {
        return `https://graph.microsoft.com/v1.0/me/drive/items/${safeUrlPathSegment(parentFolderId, 'folderId')}/children`
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
          ...driveItemDetails(data),
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the folder was created successfully' },
    file: {
      type: 'object',
      description:
        'The created folder object with metadata including id, name, webViewLink, timestamps, parentReference, childCount, eTag, createdBy, and lastModifiedBy',
    },
  },
}
