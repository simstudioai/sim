import { createLogger } from '@/lib/logs/console/logger'
import type {
  SharepointGetListResponse,
  SharepointList,
  SharepointToolParams,
} from '@/tools/sharepoint/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SharePointGetList')

export const getListTool: ToolConfig<SharepointToolParams, SharepointGetListResponse> = {
  id: 'sharepoint_get_list',
  name: 'Get SharePoint List',
  description: 'Get metadata (and optionally columns/items) for a SharePoint list',
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
      description: 'The ID of the list to retrieve',
    },
  },

  request: {
    url: (params) => {
      const siteId = params.siteId || params.siteSelector || 'root'

      // If neither listId nor listTitle provided, list all lists in the site
      if (!params.listId) {
        const baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists`
        const url = new URL(baseUrl)
        const finalUrl = url.toString()
        logger.info('SharePoint List All Lists URL', { finalUrl, siteId })
        return finalUrl
      }

      const listSegment = params.listId
      // Default to returning items when targeting a specific list unless explicitly disabled
      const wantsItems = typeof params.includeItems === 'boolean' ? params.includeItems : true

      // If caller wants items for a specific list, prefer the items endpoint (no columns)
      if (wantsItems && !params.includeColumns) {
        const itemsUrl = new URL(
          `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listSegment}/items`
        )
        itemsUrl.searchParams.set('$expand', 'fields')
        const finalItemsUrl = itemsUrl.toString()
        logger.info('SharePoint Get List Items URL', {
          finalUrl: finalItemsUrl,
          siteId,
          listId: params.listId,
        })
        return finalItemsUrl
      }

      // Otherwise, fetch list metadata (optionally with columns/items via $expand)
      const baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listSegment}`
      const url = new URL(baseUrl)
      const expandParts: string[] = []
      if (params.includeColumns) expandParts.push('columns')
      if (wantsItems) expandParts.push('items($expand=fields)')
      if (expandParts.length > 0) url.searchParams.append('$expand', expandParts.join(','))

      const finalUrl = url.toString()
      logger.info('SharePoint Get List URL', {
        finalUrl,
        siteId,
        listId: params.listId,
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

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // If the response is a collection of items (from the items endpoint)
    if (
      Array.isArray((data as any).value) &&
      (data as any).value.length > 0 &&
      (data as any).value[0] &&
      'fields' in (data as any).value[0]
    ) {
      const items = (data as any).value.map((i: any) => ({
        id: i.id,
        fields: i.fields as Record<string, unknown>,
      }))

      const nextLink: string | undefined = (data as any)['@odata.nextLink']
      const nextPageToken = nextLink
        ? (() => {
            try {
              const u = new URL(nextLink)
              return u.searchParams.get('$skiptoken') || u.searchParams.get('$skip') || undefined
            } catch {
              return undefined
            }
          })()
        : undefined

      return {
        success: true,
        output: { list: { items } as SharepointList, nextPageToken },
      }
    }

    // If this is a collection of lists (site-level)
    if (Array.isArray((data as any).value)) {
      const lists: SharepointList[] = (data as any).value.map((l: any) => ({
        id: l.id,
        displayName: l.displayName ?? l.name,
        name: l.name,
        webUrl: l.webUrl,
        createdDateTime: l.createdDateTime,
        lastModifiedDateTime: l.lastModifiedDateTime,
        list: l.list,
      }))

      const nextLink: string | undefined = (data as any)['@odata.nextLink']
      const nextPageToken = nextLink
        ? (() => {
            try {
              const u = new URL(nextLink)
              return u.searchParams.get('$skiptoken') || u.searchParams.get('$skip') || undefined
            } catch {
              return undefined
            }
          })()
        : undefined

      return {
        success: true,
        output: { lists, nextPageToken },
      }
    }

    // Single list response (with optional expands)
    const list: SharepointList = {
      id: data.id,
      displayName: data.displayName ?? data.name,
      name: data.name,
      webUrl: data.webUrl,
      createdDateTime: data.createdDateTime,
      lastModifiedDateTime: data.lastModifiedDateTime,
      list: data.list,
      columns: Array.isArray(data.columns)
        ? data.columns.map((c: any) => ({
            id: c.id,
            name: c.name,
            displayName: c.displayName,
            description: c.description,
            indexed: c.indexed,
            enforcedUniqueValues: c.enforcedUniqueValues,
            hidden: c.hidden,
            readOnly: c.readOnly,
            required: c.required,
            columnGroup: c.columnGroup,
          }))
        : undefined,
      items: Array.isArray(data.items)
        ? data.items.map((i: any) => ({ id: i.id, fields: i.fields as Record<string, unknown> }))
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
  },
}
