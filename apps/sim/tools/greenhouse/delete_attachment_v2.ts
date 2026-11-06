import type {
  GreenhouseDeleteAttachmentV2Params,
  GreenhouseDeleteAttachmentV2Response,
} from '@/tools/greenhouse/types'
import { DELETE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  mapGreenhouseFields,
  readGreenhouseRecord,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const greenhouseDeleteAttachmentV2Tool: ToolConfig<
  GreenhouseDeleteAttachmentV2Params,
  GreenhouseDeleteAttachmentV2Response
> = {
  id: 'greenhouse_delete_attachment_v2',
  name: 'Greenhouse Delete Attachment',
  description: 'Delete attachment using Greenhouse Harvest v3.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Greenhouse resource ID',
    },
  },
  request: {
    url: (params) =>
      `https://harvest.greenhouse.io/v3/attachments/${safeUrlPathSegment(params.id, 'id')}`,
    method: 'DELETE',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapGreenhouseFields(await readGreenhouseRecord(response, 'message'), DELETE_V2_OUTPUTS),
  }),
  outputs: { ...DELETE_V2_OUTPUTS },
}
