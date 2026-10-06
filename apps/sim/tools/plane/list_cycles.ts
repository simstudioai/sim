import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneCycleListResponse, PlaneListCyclesParams } from '@/tools/plane/types'
import {
  mapPlaneCycle,
  PLANE_CONNECTION_PARAMS,
  PLANE_CYCLE_PROPERTIES,
  PLANE_PAGINATION_OUTPUTS,
  PLANE_PAGINATION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  planeHeaders,
  planeProjectUrl,
  readPlanePage,
  withPlanePagination,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeListCyclesTool: ToolConfig<PlaneListCyclesParams, PlaneCycleListResponse> = {
  id: 'plane_list_cycles',
  name: 'Plane List Cycles',
  description: 'List the cycles (sprints) in a Plane project with work item counts',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    cycleView: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Which cycles to return: all (default), current, upcoming, completed, draft, or incomplete. "current" returns a single unpaginated page',
    },
    ...PLANE_PAGINATION_PARAMS,
  },

  request: {
    url: (params) =>
      withPlanePagination(planeProjectUrl(params, 'cycles/'), params, {
        cycle_view: params.cycleView,
      }),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const { results, pagination } = readPlanePage(await response.json())
    return { success: true, output: { cycles: results.map(mapPlaneCycle), ...pagination } }
  },

  outputs: {
    cycles: {
      type: 'array',
      description: 'Cycles on this page',
      items: { type: 'object', properties: PLANE_CYCLE_PROPERTIES },
    },
    ...PLANE_PAGINATION_OUTPUTS,
  },
}
