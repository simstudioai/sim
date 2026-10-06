import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneCommentResponse, PlaneUpdateCommentParams } from '@/tools/plane/types'
import {
  mapPlaneComment,
  PLANE_COMMENT_PROPERTIES,
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
  planeHeaders,
  planePathSegment,
  planeWorkItemUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeUpdateCommentTool: ToolConfig<PlaneUpdateCommentParams, PlaneCommentResponse> = {
  id: 'plane_update_comment',
  name: 'Plane Update Comment',
  description: 'Replace the body of a comment on a Plane work item',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_WORK_ITEM_ID_PARAM,
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment ID (UUID)',
    },
    comment: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New comment body as HTML',
    },
  },

  request: {
    url: (params) =>
      planeWorkItemUrl(params, `comments/${planePathSegment(params.commentId, 'commentId')}/`),
    method: 'PATCH',
    headers: planeHeaders,
    body: (params) => ({ comment_html: params.comment }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: { comment: mapPlaneComment(data) } }
  },

  outputs: {
    comment: {
      type: 'object',
      description: 'The updated comment',
      properties: PLANE_COMMENT_PROPERTIES,
    },
  },
}
