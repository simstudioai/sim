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
      const folderId = params.folderId || params.folderSelector
      const baseUrl = folderId
        ? `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`
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

      // Remove the $skip logic entirely. Instead, use the full nextLink URL if provided
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
      throw new Error(data.error?.message || 'Failed to list OneDrive files')
    }

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
  transformError: (error) => {
    return error.message || 'An error occurred while listing OneDrive files'
  },
}
