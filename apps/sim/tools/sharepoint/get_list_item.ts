import type { SharepointGetListItemResponse, SharepointToolParams } from '@/tools/sharepoint/types'
import { optionalTrim } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const getListItemTool: ToolConfig<SharepointToolParams, SharepointGetListItemResponse> = {
  id: 'sharepoint_get_list_item',
  name: 'Get SharePoint List Item',
  description: 'Get a single item (with field values) from a SharePoint list',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'sharepoint',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the SharePoint API',
    },
    siteSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Select the SharePoint site',
    },
    siteId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the SharePoint site (internal use)',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the list containing the item. Example: b!abc123def456 or a GUID like 12345678-1234-1234-1234-123456789012',
    },
    itemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the list item to retrieve. Example: 1, 42, or 123',
    },
  },

  request: {
    url: (params) => {
      const siteId = optionalTrim(params.siteId) || optionalTrim(params.siteSelector) || 'root'
      const listId = optionalTrim(params.listId)
      const itemId = optionalTrim(params.itemId)
      if (!listId) throw new Error('listId must be provided')
      if (!itemId) throw new Error('itemId must be provided')
      const listSegment = encodeURIComponent(listId)
      const itemSegment = encodeURIComponent(itemId)
      const url = new URL(
        `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/lists/${listSegment}/items/${itemSegment}`
      )
      url.searchParams.set('$expand', 'fields')
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data: Record<string, unknown> = await response.json()

    return {
      success: true,
      output: {
        item: {
          id: data.id as string,
          fields: data.fields as Record<string, unknown> | undefined,
        },
      },
    }
  },

  outputs: {
    item: {
      type: 'object',
      description: 'SharePoint list item with field values',
      properties: {
        id: { type: 'string', description: 'Item ID' },
        fields: { type: 'object', description: 'Field values for the item' },
      },
    },
  },
}
