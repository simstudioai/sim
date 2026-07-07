import type {
  MicrosoftGraphDriveItem,
  OneDriveSearchResponse,
  OneDriveToolParams,
} from '@/tools/onedrive/types'
import { escapeODataStringLiteral } from '@/tools/onedrive/utils'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<OneDriveToolParams, OneDriveSearchResponse> = {
  id: 'onedrive_search',
  name: 'Search OneDrive Files',
  description:
    'Search for files and folders across OneDrive by name, metadata, or content (recursive)',
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
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search text matched against file name, metadata, and content. Not required when paginating with pageToken',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (e.g., 10, 50, 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Continuation URL from a previous response's nextPageToken, used to fetch the next page",
    },
  },

  request: {
    url: (params) => {
      const pageToken = params.pageToken?.trim()
      if (pageToken) {
        const continuationUrl = new URL(pageToken)
        if (continuationUrl.hostname !== 'graph.microsoft.com') {
          throw new Error('Invalid page token: must be a Microsoft Graph continuation URL')
        }
        return continuationUrl.toString()
      }

      const query = params.query?.trim()
      if (!query) {
        throw new Error('A search query is required')
      }

      const url = new URL(
        `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(escapeODataStringLiteral(query))}')`
      )
      url.searchParams.append(
        '$select',
        'id,name,file,folder,webUrl,size,createdDateTime,lastModifiedDateTime,parentReference,@microsoft.graph.downloadUrl'
      )
      if (params.pageSize) {
        url.searchParams.append('$top', Number(params.pageSize).toString())
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
        files: (data.value || []).map((item: MicrosoftGraphDriveItem) => ({
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
        nextPageToken: data['@odata.nextLink'] || undefined,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the search completed successfully' },
    files: {
      type: 'array',
      description: 'Array of file and folder objects matching the search query',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for retrieving the next page of results (optional)',
    },
  },
}
