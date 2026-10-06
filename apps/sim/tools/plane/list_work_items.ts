import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneListWorkItemsParams, PlaneWorkItemListResponse } from '@/tools/plane/types'
import {
  mapPlaneWorkItem,
  PLANE_CONNECTION_PARAMS,
  PLANE_PAGINATION_OUTPUTS,
  PLANE_PAGINATION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_PROPERTIES,
  planeHeaders,
  planeProjectUrl,
  readPlanePage,
  withPlanePagination,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeListWorkItemsTool: ToolConfig<
  PlaneListWorkItemsParams,
  PlaneWorkItemListResponse
> = {
  id: 'plane_list_work_items',
  name: 'Plane List Work Items',
  description: 'List work items in a Plane project with cursor pagination',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort field, prefixed with "-" for descending (e.g., -created_at, updated_at, priority, target_date, sequence_id). Defaults to -created_at',
    },
    ...PLANE_PAGINATION_PARAMS,
  },

  request: {
    url: (params) =>
      withPlanePagination(planeProjectUrl(params, 'work-items/'), params, {
        order_by: params.orderBy,
      }),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const { results, pagination } = readPlanePage(await response.json())
    return {
      success: true,
      output: { workItems: results.map(mapPlaneWorkItem), ...pagination },
    }
  },

  outputs: {
    workItems: {
      type: 'array',
      description: 'Work items on this page',
      items: { type: 'object', properties: PLANE_WORK_ITEM_PROPERTIES },
    },
    ...PLANE_PAGINATION_OUTPUTS,
  },
}
