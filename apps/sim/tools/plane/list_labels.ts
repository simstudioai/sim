import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneLabelListResponse, PlaneListLabelsParams } from '@/tools/plane/types'
import {
  mapPlaneLabel,
  PLANE_CONNECTION_PARAMS,
  PLANE_LABEL_PROPERTIES,
  PLANE_PAGINATION_OUTPUTS,
  PLANE_PAGINATION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  planeHeaders,
  planeProjectUrl,
  readPlanePage,
  withPlanePagination,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeListLabelsTool: ToolConfig<PlaneListLabelsParams, PlaneLabelListResponse> = {
  id: 'plane_list_labels',
  name: 'Plane List Labels',
  description: 'List the labels defined in a Plane project',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_PAGINATION_PARAMS,
  },

  request: {
    url: (params) => withPlanePagination(planeProjectUrl(params, 'labels/'), params),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const { results, pagination } = readPlanePage(await response.json())
    return { success: true, output: { labels: results.map(mapPlaneLabel), ...pagination } }
  },

  outputs: {
    labels: {
      type: 'array',
      description: 'Labels on this page',
      items: { type: 'object', properties: PLANE_LABEL_PROPERTIES },
    },
    ...PLANE_PAGINATION_OUTPUTS,
  },
}
