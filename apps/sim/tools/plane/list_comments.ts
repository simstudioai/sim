import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneCommentListResponse, PlaneListCommentsParams } from '@/tools/plane/types'
import {
  mapPlaneComment,
  PLANE_COMMENT_PROPERTIES,
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

export const planeListCommentsTool: ToolConfig<PlaneListCommentsParams, PlaneCommentListResponse> =
  {
    id: 'plane_list_comments',
    name: 'Plane List Comments',
    description: 'List comments on a Plane work item, newest first',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.PLANE_ERRORS,

    params: {
      ...PLANE_CONNECTION_PARAMS,
      ...PLANE_PROJECT_ID_PARAM,
      ...PLANE_WORK_ITEM_ID_PARAM,
      ...PLANE_PAGINATION_PARAMS,
    },

    request: {
      url: (params) => withPlanePagination(planeWorkItemUrl(params, 'comments/'), params),
      method: 'GET',
      headers: planeHeaders,
    },

    transformResponse: async (response) => {
      const { results, pagination } = readPlanePage(await response.json())
      return { success: true, output: { comments: results.map(mapPlaneComment), ...pagination } }
    },

    outputs: {
      comments: {
        type: 'array',
        description: 'Comments on this page',
        items: { type: 'object', properties: PLANE_COMMENT_PROPERTIES },
      },
      ...PLANE_PAGINATION_OUTPUTS,
    },
  }
