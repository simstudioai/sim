import {
  INCIDENTIO_CATALOG_TYPE_OUTPUT_PROPERTIES,
  type IncidentioCatalogEntriesListParams,
  type IncidentioCatalogEntriesListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

/** incident.io requires a page size on this endpoint, so fall back to its documented default. */
const DEFAULT_PAGE_SIZE = 25

export const catalogEntriesListTool: ToolConfig<
  IncidentioCatalogEntriesListParams,
  IncidentioCatalogEntriesListResponse
> = {
  id: 'incidentio_catalog_entries_list',
  name: 'List Catalog Entries',
  description:
    'List the entries of a catalog type in incident.io — for example every service, team, or customer recorded in the catalog',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    catalog_type_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the catalog type to list entries for (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (e.g., 10, 25, 50). Default: 25',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor to fetch the next page of results (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    identifier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return entries matching this identifier. Searches by ID, external ID, and alias.',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v3/catalog_entries')
      url.searchParams.set('catalog_type_id', params.catalog_type_id.trim())
      url.searchParams.set(
        'page_size',
        String(params.page_size && params.page_size > 0 ? params.page_size : DEFAULT_PAGE_SIZE)
      )

      if (params.after) url.searchParams.set('after', params.after)
      if (params.identifier) url.searchParams.set('identifier', params.identifier.trim())

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        catalog_entries: data.catalog_entries ?? [],
        catalog_type: data.catalog_type ?? null,
        pagination_meta: data.pagination_meta,
      },
    }
  },

  outputs: {
    catalog_entries: {
      type: 'array',
      description: 'List of catalog entries',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Catalog entry ID' },
          name: { type: 'string', description: 'Human readable name of this entry' },
          catalog_type_id: { type: 'string', description: 'ID of the catalog type' },
          external_id: {
            type: 'string',
            description: 'Alternative ID for this entry, unique within the type',
            optional: true,
          },
          aliases: {
            type: 'array',
            description: 'Alternative names this entry can be referenced by',
            items: { type: 'string' },
          },
          rank: { type: 'number', description: 'Ordering rank, used when the type is ranked' },
          attribute_values: { type: 'json', description: 'Attribute values of this entry' },
          archived_at: {
            type: 'string',
            description: 'When this entry was archived',
            optional: true,
          },
          created_at: { type: 'string', description: 'When this entry was created' },
          updated_at: { type: 'string', description: 'When this entry was last updated' },
        },
      },
    },
    catalog_type: {
      type: 'object',
      description: 'The catalog type these entries belong to',
      nullable: true,
      properties: INCIDENTIO_CATALOG_TYPE_OUTPUT_PROPERTIES,
    },
    pagination_meta: {
      type: 'object',
      description: 'Pagination metadata',
      optional: true,
      properties: {
        after: { type: 'string', description: 'Cursor for next page', optional: true },
        page_size: { type: 'number', description: 'Number of results per page' },
      },
    },
  },
}
