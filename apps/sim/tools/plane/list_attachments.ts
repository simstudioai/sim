import { toArray } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneAttachmentListResponse, PlaneListAttachmentsParams } from '@/tools/plane/types'
import {
  mapPlaneAttachment,
  PLANE_ATTACHMENT_PROPERTIES,
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
  planeHeaders,
  planeWorkItemUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeListAttachmentsTool: ToolConfig<
  PlaneListAttachmentsParams,
  PlaneAttachmentListResponse
> = {
  id: 'plane_list_attachments',
  name: 'Plane List Attachments',
  description: 'List the uploaded file attachments on a Plane work item',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_WORK_ITEM_ID_PARAM,
  },

  request: {
    url: (params) => planeWorkItemUrl(params, 'attachments/'),
    method: 'GET',
    headers: planeHeaders,
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: { attachments: toArray(data).map(mapPlaneAttachment) } }
  },

  outputs: {
    attachments: {
      type: 'array',
      description: 'Attachments on the work item',
      items: { type: 'object', properties: PLANE_ATTACHMENT_PROPERTIES },
    },
  },
}
