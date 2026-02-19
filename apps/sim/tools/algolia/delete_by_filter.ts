import type {
  AlgoliaDeleteByFilterParams,
  AlgoliaDeleteByFilterResponse,
} from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const deleteByFilterTool: ToolConfig<
  AlgoliaDeleteByFilterParams,
  AlgoliaDeleteByFilterResponse
> = {
  id: 'algolia_delete_by_filter',
  name: 'Algolia Delete By Filter',
  description: 'Delete all records matching a filter from an Algolia index',
  version: '1.0',

  params: {
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Algolia Application ID',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Algolia Admin API Key (must have deleteIndex ACL)',
    },
    indexName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the Algolia index',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter expression to match records for deletion (e.g., "category:outdated")',
    },
    facetFilters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of facet filters (e.g., ["brand:Acme"])',
    },
    numericFilters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of numeric filters (e.g., ["price > 100"])',
    },
    tagFilters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of tag filters using the _tags attribute (e.g., ["published"])',
    },
    aroundLatLng: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Coordinates for geo-search filter (e.g., "40.71,-74.01")',
    },
    aroundRadius: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum radius in meters for geo-search, or "all" for unlimited',
    },
    insideBoundingBox: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bounding box coordinates as [[lat1, lng1, lat2, lng2]] for geo-search filter',
    },
    insidePolygon: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Polygon coordinates as [[lat1, lng1, lat2, lng2, lat3, lng3, ...]] for geo-search filter',
    },
  },

  request: {
    url: (params) =>
      `https://${params.applicationId}.algolia.net/1/indexes/${encodeURIComponent(params.indexName)}/deleteByQuery`,
    method: 'POST',
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.filters) {
        body.filters = params.filters
      }
      if (params.facetFilters) {
        body.facetFilters =
          typeof params.facetFilters === 'string'
            ? JSON.parse(params.facetFilters)
            : params.facetFilters
      }
      if (params.numericFilters) {
        body.numericFilters =
          typeof params.numericFilters === 'string'
            ? JSON.parse(params.numericFilters)
            : params.numericFilters
      }
      if (params.tagFilters) {
        body.tagFilters =
          typeof params.tagFilters === 'string' ? JSON.parse(params.tagFilters) : params.tagFilters
      }
      if (params.aroundLatLng) {
        body.aroundLatLng = params.aroundLatLng
      }
      if (params.aroundRadius !== undefined) {
        body.aroundRadius = params.aroundRadius === 'all' ? 'all' : Number(params.aroundRadius)
      }
      if (params.insideBoundingBox) {
        body.insideBoundingBox =
          typeof params.insideBoundingBox === 'string'
            ? JSON.parse(params.insideBoundingBox)
            : params.insideBoundingBox
      }
      if (params.insidePolygon) {
        body.insidePolygon =
          typeof params.insidePolygon === 'string'
            ? JSON.parse(params.insidePolygon)
            : params.insidePolygon
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        taskID: data.taskID ?? 0,
        updatedAt: data.updatedAt ?? null,
      },
    }
  },

  outputs: {
    taskID: {
      type: 'number',
      description: 'Algolia task ID for tracking the delete-by-filter operation',
    },
    updatedAt: {
      type: 'string',
      description: 'Timestamp when the operation was performed',
      optional: true,
    },
  },
}
