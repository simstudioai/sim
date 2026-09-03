import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpGetRequestParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_REQUEST_PROPERTIES } from '@/tools/manageengine_sdp/types'
import { buildSdpHeaders, getSdpApiBase, parseSdpResponse } from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpGetRequestTool: ToolConfig<SdpGetRequestParams, SdpResponse> = {
  id: 'manageengine_sdp_get_request',
  name: 'ManageEngine SDP Get Request',
  description: 'Retrieve a single ManageEngine ServiceDesk Plus Cloud request by ID.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    requestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the request to retrieve',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/requests/${safeUrlPathSegment(params.requestId, 'Request ID')}`,
    method: 'GET',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to get request')
    return { success: true, output: { request: data.request ?? null } }
  },

  outputs: {
    request: {
      type: 'object',
      description: 'The request',
      nullable: true,
      properties: SDP_REQUEST_PROPERTIES,
    },
  },
}
