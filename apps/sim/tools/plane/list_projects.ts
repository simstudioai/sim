import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneListProjectsParams, PlaneProjectListResponse } from '@/tools/plane/types'
import {
  mapPlaneProject,
  PLANE_CONNECTION_PARAMS,
  PLANE_PAGINATION_OUTPUTS,
  PLANE_PAGINATION_PARAMS,
  PLANE_PROJECT_PROPERTIES,
  planeHeaders,
  planeWorkspaceUrl,
  readPlanePage,
  withPlanePagination,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeListProjectsTool: ToolConfig<PlaneListProjectsParams, PlaneProjectListResponse> =
  {
    id: 'plane_list_projects',
    name: 'Plane List Projects',
    description: 'List the projects you can access in a Plane workspace',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.PLANE_ERRORS,

    params: {
      ...PLANE_CONNECTION_PARAMS,
      orderBy: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Sort field, prefixed with "-" for descending (name, created_at, updated_at, sort_order). Defaults to your sidebar order',
      },
      ...PLANE_PAGINATION_PARAMS,
    },

    request: {
      url: (params) =>
        withPlanePagination(planeWorkspaceUrl(params, 'projects/'), params, {
          order_by: params.orderBy,
        }),
      method: 'GET',
      headers: planeHeaders,
    },

    transformResponse: async (response) => {
      const { results, pagination } = readPlanePage(await response.json())
      return { success: true, output: { projects: results.map(mapPlaneProject), ...pagination } }
    },

    outputs: {
      projects: {
        type: 'array',
        description: 'Projects on this page',
        items: { type: 'object', properties: PLANE_PROJECT_PROPERTIES },
      },
      ...PLANE_PAGINATION_OUTPUTS,
    },
  }
