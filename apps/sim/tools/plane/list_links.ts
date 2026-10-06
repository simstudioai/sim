import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneLinkListResponse, PlaneListLinksParams } from '@/tools/plane/types'
import {
  mapPlaneLink,
  PLANE_CONNECTION_PARAMS,
  PLANE_LINK_PROPERTIES,
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

export const planeListLinksTool: ToolConfig<PlaneListLinksParams, PlaneLinkListResponse> = {
  id: 'plane_list_links',
  name: 'Plane List Links',
  description: 'List the external links attached to a Plane work item',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_WORK_ITEM_ID_PARAM,
    ...PLANE_PAGINATION_PARAMS,
  },

  request: {
    url: (params) => withPlanePagination(planeWorkItemUrl(params, 'links/'), params),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const { results, pagination } = readPlanePage(await response.json())
    return { success: true, output: { links: results.map(mapPlaneLink), ...pagination } }
  },

  outputs: {
    links: {
      type: 'array',
      description: 'Links on this page',
      items: { type: 'object', properties: PLANE_LINK_PROPERTIES },
    },
    ...PLANE_PAGINATION_OUTPUTS,
  },
}
