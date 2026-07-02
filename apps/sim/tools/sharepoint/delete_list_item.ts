import type {
  SharepointDeleteListItemResponse,
  SharepointToolParams,
} from '@/tools/sharepoint/types'
import { optionalTrim } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteListItemTool: ToolConfig<
  SharepointToolParams,
  SharepointDeleteListItemResponse
> = {
  id: 'sharepoint_delete_list_item',
  name: 'Delete SharePoint List Item',
  description: 'Delete an item from a SharePoint list',
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
      description: 'The ID of the list item to delete. Example: 1, 42, or 123',
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
      return `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listSegment}/items/${itemSegment}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (_response: Response, params) => {
    return {
      success: true,
      output: {
        deleted: true,
        itemId: params?.itemId ?? '',
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the list item was deleted' },
    itemId: { type: 'string', description: 'The ID of the deleted list item' },
  },
}
