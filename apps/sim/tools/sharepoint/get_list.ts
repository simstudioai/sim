import { createLogger } from '@sim/logger'
import type {
  SharepointGetListResponse,
  SharepointList,
  SharepointToolParams,
} from '@/tools/sharepoint/types'
import {
  assertGraphNextPageUrlForCollection,
  getGraphNextPageUrl,
  graphPathSegment,
  LIST_ITEM_OUTPUT_PROPERTIES,
  mapListItem,
  optionalTrim,
} from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SharePointGetList')

const MAX_ITEMS_PAGE_SIZE = 5000

function wantsItemsCollection(params: SharepointToolParams): boolean {
  const nextPageUrl = optionalTrim(params.nextPageUrl)
  if (nextPageUrl) {
    const segments = new URL(nextPageUrl).pathname.split('/').filter(Boolean)
    return segments[segments.length - 1]?.toLowerCase() === 'items'
  }
  const wantsItems = typeof params.includeItems === 'boolean' ? params.includeItems : true
  return Boolean(optionalTrim(params.listId)) && wantsItems && !params.includeColumns
}

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
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "OData $filter applied when reading list items. Reference columns as fields/<InternalName>. Example: fields/Status eq 'Active'",
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of list items to return per page (1-5000)',
    },
    selectFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated column internal names to return in each item's fields. Example: Title,Status,DueDate",
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
        return assertGraphNextPageUrlForCollection(params.nextPageUrl, ['items', 'lists'])
      }

      const siteId = optionalTrim(params.siteId) || optionalTrim(params.siteSelector) || 'root'
      const encodedSiteId = graphPathSegment(siteId, 'siteId')
      const listId = optionalTrim(params.listId)

      if (!listId) {
        const baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodedSiteId}/lists`
        const url = new URL(baseUrl)
        const finalUrl = url.toString()
        logger.info('SharePoint List All Lists URL', {
          finalUrl,
          siteId,
        })
        return finalUrl
      }

      const listSegment = graphPathSegment(listId, 'listId')
      const wantsItems = typeof params.includeItems === 'boolean' ? params.includeItems : true

      if (wantsItems && !params.includeColumns) {
        const itemsUrl = new URL(
          `https://graph.microsoft.com/v1.0/sites/${encodedSiteId}/lists/${listSegment}/items`
        )
        const selectFields = optionalTrim(params.selectFields)
        itemsUrl.searchParams.set(
          '$expand',
          selectFields ? `fields($select=${selectFields})` : 'fields'
        )
        const filter = optionalTrim(params.filter)
        if (filter) itemsUrl.searchParams.set('$filter', filter)
        if (params.top !== undefined && params.top !== null && String(params.top).trim()) {
          const top = Number(params.top)
          if (!Number.isInteger(top) || top < 1 || top > MAX_ITEMS_PAGE_SIZE) {
            throw new Error(`top must be an integer between 1 and ${MAX_ITEMS_PAGE_SIZE}`)
          }
          itemsUrl.searchParams.set('$top', String(top))
        }
        const finalItemsUrl = itemsUrl.toString()
        logger.info('SharePoint Get List Items URL', {
          finalUrl: finalItemsUrl,
          siteId,
          listId,
        })
        return finalItemsUrl
      }

      if (
        params.includeColumns &&
        (optionalTrim(params.filter) ||
          optionalTrim(params.selectFields) ||
          (params.top !== undefined && params.top !== null && String(params.top).trim()))
      ) {
        throw new Error(
          'filter, top, and selectFields apply only when includeColumns is false; read columns and filtered items in separate calls'
        )
      }

      const baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodedSiteId}/lists/${listSegment}`
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
      ...(optionalTrim(params.filter) || /(\$|%24)filter=/i.test(params.nextPageUrl ?? '')
        ? { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' }
        : {}),
    }),
  },

  transformResponse: async (response: Response, params) => {
    const data: Record<string, unknown> = await response.json()
    const value = data.value

    const firstValue = Array.isArray(value) ? value[0] : undefined
    const looksLikeItems =
      typeof firstValue === 'object' && firstValue !== null && 'fields' in firstValue
    if (Array.isArray(value) && (looksLikeItems || (params && wantsItemsCollection(params)))) {
      const items = value.map((i: Record<string, unknown>) => mapListItem(i))

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
        ? data.items.map((i: Record<string, unknown>) => mapListItem(i))
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
            properties: LIST_ITEM_OUTPUT_PROPERTIES,
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
        properties: LIST_ITEM_OUTPUT_PROPERTIES,
      },
    },
    nextPageUrl: {
      type: 'string',
      description: 'Full Microsoft Graph @odata.nextLink URL for the next page of results',
      optional: true,
    },
  },
}
