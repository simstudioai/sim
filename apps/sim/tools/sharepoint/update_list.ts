import { createLogger } from '@/lib/logs/console/logger'
import type {
  SharepointToolParams,
  SharepointUpdateListItemResponse,
} from '@/tools/sharepoint/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SharePointUpdateListItem')

export const updateListItemTool: ToolConfig<SharepointToolParams, SharepointUpdateListItemResponse> = {
  id: 'sharepoint_update_list',
  name: 'Update SharePoint List Item',
  description: 'Update the properties (fields) on a SharePoint list item',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'sharepoint',
    additionalScopes: ['openid', 'profile', 'email', 'Sites.ReadWrite.All', 'offline_access'],
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
      required: false,
      visibility: 'user-only',
      description: 'The ID of the list containing the item',
    },
    itemId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the list item to update',
    },
    itemFields: {
      type: 'object',
      required: true,
      visibility: 'user-only',
      description: 'Field values to update on the list item',
    },
  },

  request: {
    url: (params) => {
      const siteId = params.siteId || params.siteSelector || 'root'
      if (!params.itemId) throw new Error('itemId is required')
      if (!params.listId && !params.listTitle) {
        throw new Error('Either listId or listTitle must be provided')
      }
      const listSegment = params.listId || params.listTitle
      return `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listSegment}/items/${params.itemId}/fields`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      if (!params.itemFields || Object.keys(params.itemFields).length === 0) {
        throw new Error('itemFields must not be empty')
      }
      logger.info('Updating SharePoint list item fields', {
        itemId: params.itemId,
        listId: params.listId,
        listTitle: params.listTitle,
        fieldsKeys: Object.keys(params.itemFields),
      })
      return params.itemFields
    },
  },

  transformResponse: async (response: Response, params) => {
    let fields: Record<string, unknown> | undefined
    if (response.status !== 204) {
      try {
        fields = await response.json()
      } catch {
        // Fall back to submitted fields if no body is returned
        fields = params?.itemFields
      }
    } else {
      fields = params?.itemFields
    }

    return {
      success: true,
      output: {
        item: {
          id: params?.itemId!,
          fields,
        },
      },
    }
  },

  outputs: {
    item: {
      type: 'object',
      description: 'Updated SharePoint list item',
      properties: {
        id: { type: 'string', description: 'Item ID' },
        fields: { type: 'object', description: 'Updated field values' },
      },
    },
  },
}


