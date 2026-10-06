import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneDeleteAttachmentParams, PlaneDeleteResponse } from '@/tools/plane/types'
import {
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
  planeHeaders,
  planePathSegment,
  planeWorkItemUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeDeleteAttachmentTool: ToolConfig<
  PlaneDeleteAttachmentParams,
  PlaneDeleteResponse
> = {
  id: 'plane_delete_attachment',
  name: 'Plane Delete Attachment',
  description: 'Delete a file attachment from a Plane work item',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_WORK_ITEM_ID_PARAM,
    attachmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Attachment ID (UUID)',
    },
  },

  request: {
    url: (params) =>
      planeWorkItemUrl(
        params,
        `attachments/${planePathSegment(params.attachmentId, 'attachmentId')}/`
      ),
    method: 'DELETE',
    headers: planeHeaders,
  },

  transformResponse: async (_response, params) => ({
    success: true,
    output: { deleted: true, id: params?.attachmentId.trim() ?? '' },
  }),

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the attachment was deleted' },
    id: { type: 'string', description: 'ID of the deleted attachment' },
  },
}
