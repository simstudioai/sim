import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PlaneDownloadAttachmentParams,
  PlaneDownloadAttachmentResponse,
} from '@/tools/plane/types'
import {
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
  parsePlaneContentDispositionFilename,
  planePathSegment,
  planeWorkItemUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Plane answers the attachment detail endpoint with a redirect to a short-lived signed storage URL.
 * The executor follows it and drops every request header on a cross-origin hop, so the API key is
 * never sent to the storage host.
 */
export const planeDownloadAttachmentTool: ToolConfig<
  PlaneDownloadAttachmentParams,
  PlaneDownloadAttachmentResponse
> = {
  id: 'plane_download_attachment',
  name: 'Plane Download Attachment',
  description: 'Download a file attachment from a Plane work item',
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
      description: 'Attachment ID (UUID). Use List Attachments to find attachment IDs',
    },
  },

  request: {
    url: (params) =>
      planeWorkItemUrl(
        params,
        `attachments/${planePathSegment(params.attachmentId, 'attachmentId')}/`
      ),
    method: 'GET',
    headers: (params) => ({ 'X-API-Key': params.apiKey.trim(), Accept: '*/*' }),
    responseType: 'binary',
  },

  transformResponse: async (response, params) => {
    const buffer = Buffer.from(await response.arrayBuffer())
    const name =
      parsePlaneContentDispositionFilename(response.headers.get('content-disposition')) ??
      `plane-attachment-${params?.attachmentId.trim() ?? 'file'}`
    const mimeType =
      response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
    return {
      success: true,
      output: { file: { name, mimeType, data: buffer, size: buffer.length } },
    }
  },

  outputs: {
    file: { type: 'file', description: 'The downloaded attachment, stored in execution files' },
  },
}
