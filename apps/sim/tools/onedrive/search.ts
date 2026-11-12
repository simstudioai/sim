import type {
  MicrosoftGraphDriveItem,
  OneDriveSearchResponse,
  OneDriveToolParams,
} from '@/tools/onedrive/types'
import {
  DRIVE_ITEM_SELECT,
  escapeODataStringLiteral,
  ONEDRIVE_FILE_OUTPUT_PROPERTIES,
  toOneDriveFile,
} from '@/tools/onedrive/utils'
import { assertGraphNextPageUrl, getGraphNextPageUrl } from '@/tools/sharepoint/utils'
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
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'OData $orderby expression to sort results (e.g., "name", "lastModifiedDateTime desc")',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results per page (e.g., 10, 50, 100)',
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
        return assertGraphNextPageUrl(pageToken)
      }

      const query = params.query?.trim()
      if (!query) {
        throw new Error('A search query is required')
      }

      const url = new URL(
        `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(escapeODataStringLiteral(query))}')`
      )
      url.searchParams.append('$select', DRIVE_ITEM_SELECT)
      const orderBy = params.orderBy?.trim()
      if (orderBy) {
        url.searchParams.append('$orderby', orderBy)
      }
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
        files: (data.value || []).map((item: MicrosoftGraphDriveItem) => toOneDriveFile(item)),
        nextPageToken: getGraphNextPageUrl(data),
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the search completed successfully' },
    files: {
      type: 'array',
      description: 'Array of file and folder objects matching the search query',
      items: { type: 'object', properties: ONEDRIVE_FILE_OUTPUT_PROPERTIES },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for retrieving the next page of results (optional)',
    },
  },
}
