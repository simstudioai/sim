import { createLogger } from '@sim/logger'
import type {
  SharepointGetListResponse,
  SharepointList,
  SharepointToolParams,
} from '@/tools/sharepoint/types'
import { assertGraphNextPageUrl, getGraphNextPageUrl, optionalTrim } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SharePointGetList')

export const getListTool: ToolConfig<SharepointToolParams, SharepointGetListResponse> = {
  id: 'sharepoint_get_list',
  name: 'Get SharePoint List',
  description: 'Get metadata (and optionally columns/items) for a SharePoint list',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the list to retrieve. Example: b!abc123def456 or a GUID like 12345678-1234-1234-1234-123456789012',
    },
    includeColumns: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to include column definitions when retrieving a specific list',
    },
    includeItems: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to include list items when retrieving a specific list',
    },
    nextPageUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full @odata.nextLink URL from a previous Microsoft Graph page response',
    },
  },

  request: {
    url: (params) => {
      if (params.nextPageUrl) {
        return assertGraphNextPageUrl(params.nextPageUrl)
      }

      const siteId = optionalTrim(params.siteId) || optionalTrim(params.siteSelector) || 'root'
      const listId = optionalTrim(params.listId)

      if (!listId) {
        const baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists`
        const url = new URL(baseUrl)
        const finalUrl = url.toString()
        logger.info('SharePoint List All Lists URL', {
          finalUrl,
          siteId,
        })
        return finalUrl
      }

      const listSegment = encodeURIComponent(listId)
      const wantsItems = typeof params.includeItems === 'boolean' ? params.includeItems : true

      if (wantsItems && !params.includeColumns) {
        const itemsUrl = new URL(
          `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listSegment}/items`
        )
        itemsUrl.searchParams.set('$expand', 'fields')
        const finalItemsUrl = itemsUrl.toString()
        logger.info('SharePoint Get List Items URL', {
          finalUrl: finalItemsUrl,
          siteId,
          listId,
        })
        return finalItemsUrl
      }

      const baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listSegment}`
      const url = new URL(baseUrl)
      const expandParts: string[] = []
      if (params.includeColumns) expandParts.push('columns')
      if (wantsItems) expandParts.push('items(expand=fields)')
      if (expandParts.length > 0) url.searchParams.append('$expand', expandParts.join(','))

      const finalUrl = url.toString()
      logger.info('SharePoint Get List URL', {
        finalUrl,
        siteId,
        listId,
        includeColumns: !!params.includeColumns,
        includeItems: wantsItems,
      })
      return finalUrl
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    const data: Record<string, unknown> = await response.json()
    const value = data.value

    // If the response is a collection of items (from the items endpoint)
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value[0] &&
      typeof value[0] === 'object' &&
      'fields' in value[0]
    ) {
      const items = value.map((i: Record<string, unknown>) => ({
        id: i.id as string,
        fields: i.fields as Record<string, unknown>,
      }))

      const nextPageUrl = getGraphNextPageUrl(data)

      return {
        success: true,
        output: {
          list: { id: optionalTrim(params?.listId) || '', items } as SharepointList,
          items,
          nextPageUrl,
        },
      }
    }

    if (Array.isArray(value)) {
      const lists: SharepointList[] = value.map((l: Record<string, unknown>) => ({
        id: l.id as string,
        displayName: (l.displayName ?? l.name) as string | undefined,
        name: l.name as string | undefined,
        webUrl: l.webUrl as string | undefined,
        createdDateTime: l.createdDateTime as string | undefined,
        lastModifiedDateTime: l.lastModifiedDateTime as string | undefined,
        list: l.list as SharepointList['list'],
      }))

      const nextPageUrl = getGraphNextPageUrl(data)

      return {
        success: true,
        output: { lists, nextPageUrl },
      }
    }

    const list: SharepointList = {
      id: data.id as string,
      displayName: (data.displayName ?? data.name) as string | undefined,
      name: data.name as string | undefined,
      webUrl: data.webUrl as string | undefined,
      createdDateTime: data.createdDateTime as string | undefined,
      lastModifiedDateTime: data.lastModifiedDateTime as string | undefined,
      list: data.list as SharepointList['list'],
      columns: Array.isArray(data.columns)
        ? data.columns.map((c: Record<string, unknown>) => ({
            id: c.id as string | undefined,
            name: c.name as string | undefined,
            displayName: c.displayName as string | undefined,
            description: c.description as string | undefined,
            indexed: c.indexed as boolean | undefined,
            enforcedUniqueValues: c.enforcedUniqueValues as boolean | undefined,
            hidden: c.hidden as boolean | undefined,
            readOnly: c.readOnly as boolean | undefined,
            required: c.required as boolean | undefined,
            columnGroup: c.columnGroup as string | undefined,
          }))
        : undefined,
      items: Array.isArray(data.items)
        ? data.items.map((i: Record<string, unknown>) => ({
            id: i.id as string,
            fields: i.fields as Record<string, unknown>,
          }))
        : undefined,
    }

    return {
      success: true,
      output: { list },
    }
  },

  outputs: {
    list: {
      type: 'object',
      description: 'Information about the SharePoint list',
      properties: {
        id: { type: 'string', description: 'The unique ID of the list' },
        displayName: { type: 'string', description: 'The display name of the list' },
        name: { type: 'string', description: 'The internal name of the list' },
        webUrl: { type: 'string', description: 'The web URL of the list' },
        createdDateTime: { type: 'string', description: 'When the list was created' },
        lastModifiedDateTime: {
          type: 'string',
          description: 'When the list was last modified',
        },
        list: { type: 'object', description: 'List properties (e.g., template)' },
        columns: {
          type: 'array',
          description: 'List column definitions',
          items: { type: 'object' },
        },
        items: {
          type: 'array',
          description: 'List items (with fields when expanded)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Item ID' },
              fields: { type: 'object', description: 'Field values for the item' },
            },
          },
        },
      },
    },
    lists: {
      type: 'array',
      description: 'All lists in the site when no listId/title provided',
      items: { type: 'object' },
    },
    items: {
      type: 'array',
      description: 'List items with expanded fields when reading list items',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Item ID' },
          fields: { type: 'object', description: 'Field values for the item' },
        },
      },
    },
    nextPageUrl: {
      type: 'string',
      description: 'Full Microsoft Graph @odata.nextLink URL for the next page of results',
      optional: true,
    },
  },
}
