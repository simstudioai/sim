import { createLogger } from '@/lib/logs/console/logger'
import type { SharepointAddListItemResponse, SharepointToolParams } from '@/tools/sharepoint/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SharePointAddListItem')

export const addListItemTool: ToolConfig<SharepointToolParams, SharepointAddListItemResponse> = {
  id: 'sharepoint_add_list_items',
  name: 'Add SharePoint List Item',
  description: 'Add a new item to a SharePoint list',
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
      required: true,
      visibility: 'user-only',
      description: 'The ID of the list to add the item to',
    },
    listItemFields: {
      type: 'object',
      required: true,
      visibility: 'user-only',
      description: 'Field values for the new list item',
    },
  },

  request: {
    url: (params) => {
      const siteId = params.siteId || params.siteSelector || 'root'
      if (!params.listId) {
        throw new Error('listId must be provided')
      }
      const listSegment = params.listId
      return `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listSegment}/items`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      if (!params.listItemFields || Object.keys(params.listItemFields).length === 0) {
        throw new Error('listItemFields must not be empty')
      }

      const providedFields =
        typeof params.listItemFields === 'object' &&
        params.listItemFields !== null &&
        'fields' in (params.listItemFields as Record<string, unknown>) &&
        Object.keys(params.listItemFields as Record<string, unknown>).length === 1
          ? ((params.listItemFields as any).fields as Record<string, unknown>)
          : (params.listItemFields as Record<string, unknown>)

      if (!providedFields || Object.keys(providedFields).length === 0) {
        throw new Error('No fields provided to create the SharePoint list item')
      }

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

      const entries = Object.entries(providedFields)
      const creatableEntries = entries.filter(([key]) => !readOnlyFields.has(key))

      if (creatableEntries.length !== entries.length) {
        const removed = entries.filter(([key]) => readOnlyFields.has(key)).map(([key]) => key)
        logger.warn('Removed read-only SharePoint fields from create', {
          removed,
        })
      }

      if (creatableEntries.length === 0) {
        const requestedKeys = Object.keys(providedFields)
        throw new Error(
          `All provided fields are read-only and cannot be set: ${requestedKeys.join(', ')}`
        )
      }

      const sanitizedFields = Object.fromEntries(creatableEntries)

      logger.info('Creating SharePoint list item', {
        listId: params.listId,
        fieldsKeys: Object.keys(sanitizedFields),
      })

      return {
        fields: sanitizedFields,
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    let data: any
    try {
      data = await response.json()
    } catch {
      data = undefined
    }

    const itemId: string | undefined = data?.id
    const fields: Record<string, unknown> | undefined = data?.fields || params?.listItemFields

    return {
      success: true,
      output: {
        item: {
          id: itemId || 'unknown',
          fields,
        },
      },
    }
  },

  outputs: {
    item: {
      type: 'object',
      description: 'Created SharePoint list item',
      properties: {
        id: { type: 'string', description: 'Item ID' },
        fields: { type: 'object', description: 'Field values for the new item' },
      },
    },
  },
}
