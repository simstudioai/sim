import type {
  MicrosoftGraphDriveItem,
  OneDriveListResponse,
  OneDriveToolParams,
} from '@/tools/onedrive/types'
import type { ToolConfig } from '@/tools/types'

export const listTool: ToolConfig<OneDriveToolParams, OneDriveListResponse> = {
  id: 'onedrive_list',
  name: 'List OneDrive Files',
  description: 'List files and folders in OneDrive',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'onedrive',
    additionalScopes: [
      'openid',
      'profile',
      'email',
      'Files.Read',
      'Files.ReadWrite',
      'offline_access',
    ],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the OneDrive API',
    },
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Select the folder to list files from',
    },
    manualFolderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The manually entered folder ID (advanced mode)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A query to filter the files',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'The number of files to return',
    },
  },

  request: {
    url: (params) => {
      // Use specific folder if provided, otherwise use root
      const folderId = params.manualFolderId || params.folderSelector
      const encodedFolderId = folderId ? encodeURIComponent(folderId) : ''
      const baseUrl = encodedFolderId
        ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodedFolderId}/children`
        : 'https://graph.microsoft.com/v1.0/me/drive/root/children'

      const url = new URL(baseUrl)

      // Use Microsoft Graph $select parameter
      url.searchParams.append(
        '$select',
        'id,name,file,folder,webUrl,size,createdDateTime,lastModifiedDateTime,parentReference'
      )

      // Add name filter if query provided
      if (params.query) {
        url.searchParams.append('$filter', `startswith(name,'${params.query}')`)
      }

      // Add pagination
      if (params.pageSize) {
        url.searchParams.append('$top', params.pageSize.toString())
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

    return {
      success: true,
      output: {
        files: data.value.map((item: MicrosoftGraphDriveItem) => ({
          id: item.id,
          name: item.name,
          mimeType: item.file?.mimeType || (item.folder ? 'application/folder' : 'unknown'),
          webViewLink: item.webUrl,
          webContentLink: item['@microsoft.graph.downloadUrl'],
          size: item.size?.toString() || '0',
          createdTime: item.createdDateTime,
          modifiedTime: item.lastModifiedDateTime,
          parents: item.parentReference ? [item.parentReference.id] : [],
        })),
        // Use the actual @odata.nextLink URL as the continuation token
        nextPageToken: data['@odata.nextLink'] || undefined,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether files were listed successfully' },
    files: { type: 'array', description: 'Array of file and folder objects with metadata' },
    nextPageToken: {
      type: 'string',
      description: 'Token for retrieving the next page of results (optional)',
    },
  },
}
