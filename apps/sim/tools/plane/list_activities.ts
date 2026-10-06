import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneActivityListResponse, PlaneListActivitiesParams } from '@/tools/plane/types'
import {
  mapPlaneActivity,
  PLANE_ACTIVITY_PROPERTIES,
  PLANE_CONNECTION_PARAMS,
  PLANE_PAGINATION_OUTPUTS,
  PLANE_PAGINATION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
  planeHeaders,
  planeWorkItemUrl,
  readPlanePage,
  withPlanePagination,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeListActivitiesTool: ToolConfig<
  PlaneListActivitiesParams,
  PlaneActivityListResponse
> = {
  id: 'plane_list_activities',
  name: 'Plane List Work Item Activity',
  description: 'List the change history of a Plane work item (state, assignee, field changes)',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_WORK_ITEM_ID_PARAM,
    ...PLANE_PAGINATION_PARAMS,
  },

  request: {
    url: (params) => withPlanePagination(planeWorkItemUrl(params, 'activities/'), params),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const { results, pagination } = readPlanePage(await response.json())
    return {
      success: true,
      output: { activities: results.map(mapPlaneActivity), ...pagination },
    }
  },

  outputs: {
    activities: {
      type: 'array',
      description: 'Activity entries on this page',
      items: { type: 'object', properties: PLANE_ACTIVITY_PROPERTIES },
    },
    ...PLANE_PAGINATION_OUTPUTS,
  },
}
