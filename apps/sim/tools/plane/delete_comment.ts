import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneDeleteCommentParams, PlaneDeleteResponse } from '@/tools/plane/types'
import {
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
  planeHeaders,
  planePathSegment,
  planeWorkItemUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeDeleteCommentTool: ToolConfig<PlaneDeleteCommentParams, PlaneDeleteResponse> = {
  id: 'plane_delete_comment',
  name: 'Plane Delete Comment',
  description: 'Delete a comment from a Plane work item',
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
  },

  request: {
    url: (params) => planeWorkItemUrl(params, `comments/${planePathSegment(params.commentId)}/`),
    method: 'DELETE',
    headers: planeHeaders,
  },

  transformResponse: async (_response, params) => ({
    success: true,
    output: { deleted: true, id: params?.commentId.trim() ?? '' },
  }),

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the comment was deleted' },
    id: { type: 'string', description: 'ID of the deleted comment' },
  },
}
