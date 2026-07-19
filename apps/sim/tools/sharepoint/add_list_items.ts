import type { SharepointAddListItemResponse, SharepointToolParams } from '@/tools/sharepoint/types'
import { optionalTrim, sanitizeListItemFields } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

function resolveSanitizedFields(
  listItemFields: SharepointToolParams['listItemFields']
): Record<string, unknown> {
  if (!listItemFields || Object.keys(listItemFields).length === 0) {
    throw new Error('listItemFields must not be empty')
  }

  const providedFields =
    typeof listItemFields === 'object' &&
    listItemFields !== null &&
    'fields' in (listItemFields as Record<string, unknown>) &&
    Object.keys(listItemFields as Record<string, unknown>).length === 1
      ? ((listItemFields as { fields: Record<string, unknown> }).fields as Record<string, unknown>)
      : (listItemFields as Record<string, unknown>)

  if (!providedFields || Object.keys(providedFields).length === 0) {
    throw new Error('No fields provided to create the SharePoint list item')
  }

  return sanitizeListItemFields(providedFields, { action: 'create' })
}

export const addListItemTool: ToolConfig<SharepointToolParams, SharepointAddListItemResponse> = {
  id: 'sharepoint_add_list_items',
  name: 'Add SharePoint List Item',
  description: 'Add a new item to a SharePoint list',
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
        'The ID of the list to add the item to. Example: b!abc123def456 or a GUID like 12345678-1234-1234-1234-123456789012',
    },
    listItemFields: {
      type: 'json',
      required: true,
      visibility: 'user-only',
      description: 'Field values for the new list item',
    },
  },

  request: {
    url: (params) => {
      const siteId = optionalTrim(params.siteId) || optionalTrim(params.siteSelector) || 'root'
      const listId = optionalTrim(params.listId)
      if (!listId) {
        throw new Error('listId must be provided')
      }
      const listSegment = encodeURIComponent(listId)
      return `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/lists/${listSegment}/items`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => ({
      fields: resolveSanitizedFields(params.listItemFields),
    }),
  },

  transformResponse: async (response: Response, params) => {
    let data: Record<string, unknown> | undefined
    try {
      data = await response.json()
    } catch {
      data = undefined
    }

    const itemId = data?.id as string | undefined
    let fields = data?.fields as Record<string, unknown> | undefined
    if (!fields && params) {
      try {
        fields = resolveSanitizedFields(params.listItemFields)
      } catch {
        // Item was already created successfully; a malformed fallback input must not fail the response.
      }
    }

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
