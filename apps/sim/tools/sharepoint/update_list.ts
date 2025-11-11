import { createLogger } from '@/lib/logs/console/logger'
import type {
  SharepointToolParams,
  SharepointUpdateListItemResponse,
} from '@/tools/sharepoint/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SharePointUpdateListItem')

export const updateListItemTool: ToolConfig<
  SharepointToolParams,
  SharepointUpdateListItemResponse
> = {
  id: 'sharepoint_update_list',
  name: 'Update SharePoint List Item',
  description: 'Update the properties (fields) on a SharePoint list item',
  version: '1.0',

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
    listItemFields: {
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
      if (!params.listId) {
        throw new Error('listId must be provided')
      }
      const listSegment = params.listId
      return `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listSegment}/items/${params.itemId}/fields`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      if (!params.listItemFields || Object.keys(params.listItemFields).length === 0) {
        throw new Error('listItemFields must not be empty')
      }

      // Filter out system/read-only fields that cannot be updated via Graph
      const readOnlyFields = new Set<string>([
        'Id',
        'id',
        'UniqueId',
        'GUID',
        'ContentTypeId',
        'Created',
        'Modified',
        'Author',
        'Editor',
        'CreatedBy',
        'ModifiedBy',
        'AuthorId',
        'EditorId',
        '_UIVersionString',
        'Attachments',
        'FileRef',
        'FileDirRef',
        'FileLeafRef',
      ])

      const entries = Object.entries(params.listItemFields)
      const updatableEntries = entries.filter(([key]) => !readOnlyFields.has(key))

      if (updatableEntries.length !== entries.length) {
        const removed = entries.filter(([key]) => readOnlyFields.has(key)).map(([key]) => key)
        logger.warn('Removed read-only SharePoint fields from update', {
          removed,
        })
      }

      if (updatableEntries.length === 0) {
        const requestedKeys = Object.keys(params.listItemFields)
        throw new Error(
          `All provided fields are read-only and cannot be updated: ${requestedKeys.join(', ')}`
        )
      }

      const sanitizedFields = Object.fromEntries(updatableEntries)

      logger.info('Updating SharePoint list item fields', {
        listItemId: params.itemId,
        listId: params.listId,
        fieldsKeys: Object.keys(sanitizedFields),
      })
      return sanitizedFields
    },
  },

  transformResponse: async (response: Response, params) => {
    let fields: Record<string, unknown> | undefined
    if (response.status !== 204) {
      try {
        fields = await response.json()
      } catch {
        // Fall back to submitted fields if no body is returned
        fields = params?.listItemFields
      }
    } else {
      fields = params?.listItemFields
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
