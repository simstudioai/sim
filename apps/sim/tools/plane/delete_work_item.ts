import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneDeleteResponse, PlaneDeleteWorkItemParams } from '@/tools/plane/types'
import {
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
  planeHeaders,
  planePathSegment,
  planeProjectUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeDeleteWorkItemTool: ToolConfig<PlaneDeleteWorkItemParams, PlaneDeleteResponse> = {
  id: 'plane_delete_work_item',
  name: 'Plane Delete Work Item',
  description:
    'Delete a Plane work item. Only project admins or the work item creator can delete it',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_WORK_ITEM_ID_PARAM,
  },

  request: {
    url: (params) =>
      planeProjectUrl(params, `work-items/${planePathSegment(params.workItemId, 'workItemId')}/`),
    method: 'DELETE',
    headers: planeHeaders,
  },

  transformResponse: async (_response, params) => ({
    success: true,
    output: { deleted: true, id: params?.workItemId.trim() ?? '' },
  }),

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the work item was deleted' },
    id: { type: 'string', description: 'ID of the deleted work item' },
  },
}
