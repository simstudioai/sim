import { ErrorExtractorId } from '@/tools/error-extractors'
import type { CatalogListResponse, SearchCatalogObjectsParams } from '@/tools/square/types'
import {
  CATALOG_OBJECT_OUTPUT,
  LIST_METADATA_OUTPUT_PROPERTIES,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareSearchCatalogObjectsTool: ToolConfig<
  SearchCatalogObjectsParams,
  CatalogListResponse
> = {
  id: 'square_search_catalog_objects',
  name: 'Square Search Catalog Objects',
  description: 'Search catalog objects by type and query filters',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    objectTypes: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of catalog object types to search (e.g. ["ITEM","CATEGORY"])',
    },
    query: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Square catalog query object (e.g. {"text_query":{"keywords":["coffee"]}} or {"prefix_query":{...}})',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return per page',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: () => `${SQUARE_BASE_URL}/v2/catalog/search`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.objectTypes) body.object_types = params.objectTypes
      if (params.query) body.query = params.query
      if (params.limit !== undefined) body.limit = params.limit
      if (params.cursor) body.cursor = params.cursor
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const objects = data.objects ?? []
    return {
      success: true,
      output: {
        objects,
        metadata: {
          count: objects.length,
          cursor: data.cursor ?? null,
        },
      },
    }
  },

  outputs: {
    objects: {
      type: 'array',
      description: 'Array of matching catalog objects',
      items: CATALOG_OBJECT_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'List pagination metadata',
      properties: LIST_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
