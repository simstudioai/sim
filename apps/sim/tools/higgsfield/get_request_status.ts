import type { HiggsfieldRequestIdParams, HiggsfieldRequestResponse } from '@/tools/higgsfield/types'
import { HIGGSFIELD_REQUEST_OUTPUTS } from '@/tools/higgsfield/types'
import {
  buildHiggsfieldUrl,
  higgsfieldAuthParams,
  higgsfieldHeaders,
  higgsfieldOAuth,
  mapHiggsfieldRequest,
} from '@/tools/higgsfield/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const higgsfieldGetRequestStatusTool: ToolConfig<
  HiggsfieldRequestIdParams,
  HiggsfieldRequestResponse
> = {
  id: 'higgsfield_get_request_status',
  name: 'Higgsfield Get Request Status',
  description:
    'Get the status of a Higgsfield generation request and, once completed, its output URLs.',
  version: '1.0.0',
  oauth: higgsfieldOAuth,
  params: {
    ...higgsfieldAuthParams,
    requestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Higgsfield request ID returned by a generation request',
    },
  },
  request: {
    url: (params) =>
      buildHiggsfieldUrl(
        `/requests/${safeUrlPathSegment(params.requestId.trim(), 'requestId')}/status`
      ),
    method: 'GET',
    headers: (params) => higgsfieldHeaders(params.accessToken),
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapHiggsfieldRequest(await response.json()),
  }),
  outputs: HIGGSFIELD_REQUEST_OUTPUTS,
}
