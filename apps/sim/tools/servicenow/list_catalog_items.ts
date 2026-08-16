import { authParams } from '@/tools/servicenow/params'
import type {
  ServiceNowCatalogItem,
  ServiceNowListCatalogItemsParams,
  ServiceNowListCatalogItemsResponse,
} from '@/tools/servicenow/types'
import {
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  parseServiceNowResponse,
  toRecordArray,
  withQueryString,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const listCatalogItemsTool: ToolConfig<
  ServiceNowListCatalogItemsParams,
  ServiceNowListCatalogItemsResponse
> = {
  id: 'servicenow_list_catalog_items',
  name: 'List ServiceNow Catalog Items',
  description:
    'Browse or search the ServiceNow service catalog. Returns each item with its sys_id, name, description, type, category, and catalogs, which is what Order ServiceNow Catalog Item needs.',
  version: '1.0.0',

  params: {
    ...authParams,
    searchText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text to search for in the catalog items (e.g., "iPhone").',
    },
    catalogSysId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict results to a specific catalog, by catalog sys_id.',
    },
    categorySysId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict results to a specific category, by category sys_id.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (sysparm_limit).',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items to skip for pagination (sysparm_offset).',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const searchParams = new URLSearchParams()

      if (params.searchText) searchParams.append('sysparm_text', params.searchText)
      if (params.catalogSysId) searchParams.append('sysparm_catalog', params.catalogSysId)
      if (params.categorySysId) searchParams.append('sysparm_category', params.categorySysId)
      if (params.limit !== undefined && params.limit !== null) {
        searchParams.append('sysparm_limit', String(params.limit))
      }
      if (params.offset !== undefined && params.offset !== null) {
        searchParams.append('sysparm_offset', String(params.offset))
      }

      return withQueryString(`${baseUrl}/api/sn_sc/servicecatalog/items`, searchParams)
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await parseServiceNowResponse(response)
    const items = toRecordArray(data.result) as ServiceNowCatalogItem[]

    return {
      success: true,
      output: {
        items,
        metadata: { recordCount: items.length },
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Catalog items',
      items: {
        type: 'object',
        properties: {
          sys_id: { type: 'string', description: 'Catalog item sys_id, used to order the item' },
          name: { type: 'string', description: 'Catalog item name' },
          short_description: {
            type: 'string',
            description: 'Short description',
            nullable: true,
          },
          description: { type: 'string', description: 'HTML description', optional: true },
          type: {
            type: 'string',
            description: 'Item type, e.g., record_producer or catalog_item',
            optional: true,
          },
          sys_class_name: { type: 'string', description: 'Item table', optional: true },
          category: {
            type: 'json',
            description: 'Category {sys_id, title}',
            optional: true,
            nullable: true,
          },
          catalogs: {
            type: 'json',
            description: 'Catalogs the item belongs to, each {sys_id, title}',
            optional: true,
          },
          picture: { type: 'string', description: 'Item picture reference', optional: true },
          icon: { type: 'string', description: 'Item icon reference', optional: true },
          order: { type: 'number', description: 'Display order', optional: true },
          price: { type: 'string', description: 'Item price', optional: true },
          show_price: {
            type: 'boolean',
            description: 'Whether the price is shown',
            optional: true,
          },
          show_quantity: {
            type: 'boolean',
            description: 'Whether a quantity can be chosen when ordering',
            optional: true,
          },
          content_type: {
            type: 'string',
            description: 'Content type for content items',
            optional: true,
          },
          url: { type: 'string', description: 'Target URL for content items', optional: true },
          kb_article: {
            type: 'string',
            description: 'sys_id of the knowledge article backing the item',
            optional: true,
          },
        },
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        recordCount: { type: 'number', description: 'Number of catalog items returned' },
      },
    },
  },
}
