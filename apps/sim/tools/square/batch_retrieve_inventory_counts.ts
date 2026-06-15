import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  BatchRetrieveInventoryCountsParams,
  InventoryCountListResponse,
} from '@/tools/square/types'
import {
  INVENTORY_COUNT_OUTPUT,
  LIST_METADATA_OUTPUT_PROPERTIES,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareBatchRetrieveInventoryCountsTool: ToolConfig<
  BatchRetrieveInventoryCountsParams,
  InventoryCountListResponse
> = {
  id: 'square_batch_retrieve_inventory_counts',
  name: 'Square Batch Retrieve Inventory Counts',
  description: 'Retrieve current inventory counts for catalog items across locations',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    catalogObjectIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'IDs of the catalog item variations to retrieve counts for',
    },
    locationIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'IDs of the locations to retrieve counts for (defaults to all locations)',
    },
    states: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inventory states to filter by (e.g. IN_STOCK, SOLD, IN_TRANSIT)',
    },
    updatedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return counts updated after this RFC 3339 timestamp',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return per page (1-1000)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: () => `${SQUARE_BASE_URL}/v2/inventory/counts/batch-retrieve`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.catalogObjectIds) body.catalog_object_ids = params.catalogObjectIds
      if (params.locationIds) body.location_ids = params.locationIds
      if (params.states) body.states = params.states
      if (params.updatedAfter) body.updated_after = params.updatedAfter
      if (params.limit !== undefined) body.limit = params.limit
      if (params.cursor) body.cursor = params.cursor
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const counts = data.counts ?? []
    return {
      success: true,
      output: {
        counts,
        metadata: {
          count: counts.length,
          cursor: data.cursor ?? null,
        },
      },
    }
  },

  outputs: {
    counts: {
      type: 'array',
      description: 'Array of inventory count objects',
      items: INVENTORY_COUNT_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'List pagination metadata',
      properties: LIST_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
