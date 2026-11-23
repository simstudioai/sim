import type { SharepointGetListItemResponse, SharepointToolParams } from '@/tools/sharepoint/types'
import {
  graphPathSegment,
  LIST_ITEM_OUTPUT_PROPERTIES,
  mapListItem,
  optionalTrim,
} from '@/tools/sharepoint/utils'
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
    selectFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated column internal names to return in the item's fields. Example: Title,Status,DueDate",
    },
  },

  request: {
    url: (params) => {
      const siteId = optionalTrim(params.siteId) || optionalTrim(params.siteSelector) || 'root'
      const listId = optionalTrim(params.listId)
      const itemId = optionalTrim(params.itemId)
      if (!listId) throw new Error('listId must be provided')
      if (!itemId) throw new Error('itemId must be provided')
      const listSegment = graphPathSegment(listId, 'listId')
      const itemSegment = graphPathSegment(itemId, 'itemId')
      const url = new URL(
        `https://graph.microsoft.com/v1.0/sites/${graphPathSegment(siteId, 'siteId')}/lists/${listSegment}/items/${itemSegment}`
      )
      const selectFields = optionalTrim(params.selectFields)
      url.searchParams.set('$expand', selectFields ? `fields($select=${selectFields})` : 'fields')
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
        item: mapListItem(data),
      },
    }
  },

  outputs: {
    item: {
      type: 'object',
      description: 'SharePoint list item with field values',
      properties: LIST_ITEM_OUTPUT_PROPERTIES,
    },
  },
}
