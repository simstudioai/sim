import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneListModulesParams, PlaneModuleListResponse } from '@/tools/plane/types'
import {
  mapPlaneModule,
  PLANE_CONNECTION_PARAMS,
  PLANE_MODULE_PROPERTIES,
  PLANE_PAGINATION_OUTPUTS,
  PLANE_PAGINATION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  planeHeaders,
  planeProjectUrl,
  readPlanePage,
  withPlanePagination,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeListModulesTool: ToolConfig<PlaneListModulesParams, PlaneModuleListResponse> = {
  id: 'plane_list_modules',
  name: 'Plane List Modules',
  description: 'List the active (non-archived) modules in a Plane project with work item counts',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_PAGINATION_PARAMS,
  },

  request: {
    url: (params) => withPlanePagination(planeProjectUrl(params, 'modules/'), params),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const { results, pagination } = readPlanePage(await response.json())
    return { success: true, output: { modules: results.map(mapPlaneModule), ...pagination } }
  },

  outputs: {
    modules: {
      type: 'array',
      description: 'Modules on this page',
      items: { type: 'object', properties: PLANE_MODULE_PROPERTIES },
    },
    ...PLANE_PAGINATION_OUTPUTS,
  },
}
