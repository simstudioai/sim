import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneListStatesParams, PlaneStateListResponse } from '@/tools/plane/types'
import {
  mapPlaneState,
  PLANE_CONNECTION_PARAMS,
  PLANE_PAGINATION_OUTPUTS,
  PLANE_PAGINATION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_STATE_PROPERTIES,
  planeHeaders,
  planeProjectUrl,
  readPlanePage,
  withPlanePagination,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeListStatesTool: ToolConfig<PlaneListStatesParams, PlaneStateListResponse> = {
  id: 'plane_list_states',
  name: 'Plane List States',
  description:
    'List the workflow states (e.g., Backlog, Todo, In Progress, Done) of a Plane project',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_PAGINATION_PARAMS,
  },

  request: {
    url: (params) => withPlanePagination(planeProjectUrl(params, 'states/'), params),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const { results, pagination } = readPlanePage(await response.json())
    return { success: true, output: { states: results.map(mapPlaneState), ...pagination } }
  },

  outputs: {
    states: {
      type: 'array',
      description: 'States on this page',
      items: { type: 'object', properties: PLANE_STATE_PROPERTIES },
    },
    ...PLANE_PAGINATION_OUTPUTS,
  },
}
