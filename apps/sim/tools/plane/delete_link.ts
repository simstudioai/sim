import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneDeleteLinkParams, PlaneDeleteResponse } from '@/tools/plane/types'
import {
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
  planeHeaders,
  planePathSegment,
  planeWorkItemUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeDeleteLinkTool: ToolConfig<PlaneDeleteLinkParams, PlaneDeleteResponse> = {
  id: 'plane_delete_link',
  name: 'Plane Delete Link',
  description: 'Remove an external link from a Plane work item',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_WORK_ITEM_ID_PARAM,
    linkId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Link ID (UUID)',
    },
  },

  request: {
    url: (params) =>
      planeWorkItemUrl(params, `links/${planePathSegment(params.linkId, 'linkId')}/`),
    method: 'DELETE',
    headers: planeHeaders,
  },

  transformResponse: async (_response, params) => ({
    success: true,
    output: { deleted: true, id: params?.linkId.trim() ?? '' },
  }),

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the link was deleted' },
    id: { type: 'string', description: 'ID of the deleted link' },
  },
}
