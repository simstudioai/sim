import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpDeleteRequestParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { buildSdpHeaders, getSdpApiBase, parseSdpResponse } from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpDeleteRequestTool: ToolConfig<SdpDeleteRequestParams, SdpResponse> = {
  id: 'manageengine_sdp_delete_request',
  name: 'ManageEngine SDP Delete Request',
  description:
    'Move a ManageEngine ServiceDesk Plus Cloud request to the trash. Deleting a request also removes its notes, tasks and worklogs.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    requestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the request to delete',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/requests/${safeUrlPathSegment(params.requestId, 'Request ID')}`,
    method: 'DELETE',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    // The delete response carries only `response_status`; parseSdpResponse
    // throws on a failure, so reaching here means SDP accepted it.
    await parseSdpResponse(response, 'Failed to delete request')
    return { success: true, output: { deleted: true } }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the request was deleted' },
  },
}
