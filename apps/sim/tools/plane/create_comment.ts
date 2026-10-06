import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneCommentResponse, PlaneCreateCommentParams } from '@/tools/plane/types'
import {
  mapPlaneComment,
  optionalTrimmed,
  PLANE_COMMENT_PROPERTIES,
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
  planeHeaders,
  planeWorkItemUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeCreateCommentTool: ToolConfig<PlaneCreateCommentParams, PlaneCommentResponse> = {
  id: 'plane_create_comment',
  name: 'Plane Create Comment',
  description: 'Add a comment to a Plane work item',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_WORK_ITEM_ID_PARAM,
    comment: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment body as HTML (e.g., "<p>Fixed in the latest release</p>")',
    },
    access: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment visibility: INTERNAL (default) or EXTERNAL',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of this comment in an external system. With externalSource, Plane rejects duplicates (HTTP 409)',
    },
    externalSource: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the external system (e.g., "slack"), used with externalId',
    },
  },

  request: {
    url: (params) => planeWorkItemUrl(params, 'comments/'),
    method: 'POST',
    headers: planeHeaders,
    body: (params) => {
      const body: Record<string, unknown> = { comment_html: params.comment }
      const access = optionalTrimmed(params.access)?.toUpperCase()
      if (access) body.access = access
      const externalId = optionalTrimmed(params.externalId)
      const externalSource = optionalTrimmed(params.externalSource)
      if (externalId) body.external_id = externalId
      if (externalSource) body.external_source = externalSource
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: { comment: mapPlaneComment(data) } }
  },

  outputs: {
    comment: {
      type: 'object',
      description: 'The created comment',
      properties: PLANE_COMMENT_PROPERTIES,
    },
  },
}
