import { ErrorExtractorId } from '@/tools/error-extractors'
import type { CatalogListResponse, ListCatalogParams } from '@/tools/square/types'
import {
  CATALOG_OBJECT_OUTPUT,
  LIST_METADATA_OUTPUT_PROPERTIES,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareListCatalogTool: ToolConfig<ListCatalogParams, CatalogListResponse> = {
  id: 'square_list_catalog',
  name: 'Square List Catalog',
  description: 'List catalog objects, optionally filtered by type',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    types: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated catalog object types to return (e.g. ITEM,CATEGORY). Defaults to all top-level types',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${SQUARE_BASE_URL}/v2/catalog/list`)
      if (params.types) url.searchParams.append('types', params.types)
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => squareHeaders(params.apiKey),
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
      description: 'Array of catalog objects',
      items: CATALOG_OBJECT_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'List pagination metadata',
      properties: LIST_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
