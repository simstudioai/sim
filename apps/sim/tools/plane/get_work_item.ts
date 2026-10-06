import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneGetWorkItemParams, PlaneWorkItemResponse } from '@/tools/plane/types'
import {
  mapPlaneWorkItem,
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
  PLANE_WORK_ITEM_PROPERTIES,
  planeHeaders,
  planePathSegment,
  planeProjectUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeGetWorkItemTool: ToolConfig<PlaneGetWorkItemParams, PlaneWorkItemResponse> = {
  id: 'plane_get_work_item',
  name: 'Plane Get Work Item',
  description: 'Get a Plane work item by its ID',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_WORK_ITEM_ID_PARAM,
  },

  request: {
    url: (params) =>
      planeProjectUrl(params, `work-items/${planePathSegment(params.workItemId, 'workItemId')}/`),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: { workItem: mapPlaneWorkItem(data) } }
  },

  outputs: {
    workItem: {
      type: 'object',
      description: 'The work item',
      properties: PLANE_WORK_ITEM_PROPERTIES,
    },
  },
}
