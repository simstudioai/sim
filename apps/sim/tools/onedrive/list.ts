import type {
  MicrosoftGraphDriveItem,
  OneDriveListResponse,
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
import { safeUrlPathSegment } from '@/tools/url-path'

export const listTool: ToolConfig<OneDriveToolParams, OneDriveListResponse> = {
  id: 'onedrive_list',
  name: 'List OneDrive Files',
  description: 'List files and folders in OneDrive',
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
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Folder ID to list files from (e.g., "01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36M")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter files by name prefix (e.g., "report", "invoice_2024")',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'OData $orderby expression to sort results (e.g., "name", "lastModifiedDateTime desc", "size desc")',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum number of items per page (e.g., 10, 50, 100). Graph returns 200 per page by default',
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

      const folderId = params.folderId?.trim()
      const encodedFolderId = folderId ? safeUrlPathSegment(folderId, 'folderId') : ''
      const baseUrl = encodedFolderId
        ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodedFolderId}/children`
        : 'https://graph.microsoft.com/v1.0/me/drive/root/children'

      const url = new URL(baseUrl)

      url.searchParams.append('$select', DRIVE_ITEM_SELECT)

      if (params.query) {
        url.searchParams.append(
          '$filter',
          `startswith(name,'${escapeODataStringLiteral(params.query)}')`
        )
      }

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
        files: data.value.map((item: MicrosoftGraphDriveItem) => toOneDriveFile(item)),
        nextPageToken: getGraphNextPageUrl(data),
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether files were listed successfully' },
    files: {
      type: 'array',
      description: 'Array of file and folder objects with metadata',
      items: { type: 'object', properties: ONEDRIVE_FILE_OUTPUT_PROPERTIES },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for retrieving the next page of results (optional)',
    },
  },
}
