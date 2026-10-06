import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneSearchWorkItemsParams, PlaneSearchWorkItemsResponse } from '@/tools/plane/types'
import {
  mapPlaneSearchResult,
  optionalTrimmed,
  PLANE_CONNECTION_PARAMS,
  PLANE_SEARCH_RESULT_PROPERTIES,
  planeHeaders,
  planeWorkspaceUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeSearchWorkItemsTool: ToolConfig<
  PlaneSearchWorkItemsParams,
  PlaneSearchWorkItemsResponse
> = {
  id: 'plane_search_work_items',
  name: 'Plane Search Work Items',
  description:
    'Search work items across a Plane workspace by title, sequence number, or project identifier',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search text matched against work item titles, sequence numbers, and project identifiers',
    },
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Limit the search to one project (UUID). Searches all projects when omitted',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (default 10)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams({ search: params.query.trim() })
      const projectId = optionalTrimmed(params.projectId)
      if (projectId) query.set('project_id', projectId)
      const limit = Number(params.limit)
      if (params.limit !== undefined && Number.isFinite(limit) && limit > 0) {
        query.set('limit', String(Math.trunc(limit)))
      }
      return `${planeWorkspaceUrl(params, 'work-items/search/')}?${query.toString()}`
    },
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: { results: toArray(data.issues).map(mapPlaneSearchResult) },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Matching work items',
      items: { type: 'object', properties: PLANE_SEARCH_RESULT_PROPERTIES },
    },
  },
}
