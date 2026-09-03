import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpDeleteChangeParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { buildSdpHeaders, getSdpApiBase, parseSdpResponse } from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpDeleteChangeTool: ToolConfig<SdpDeleteChangeParams, SdpResponse> = {
  id: 'manageengine_sdp_delete_change',
  name: 'ManageEngine SDP Delete Change',
  description: 'Delete a ManageEngine ServiceDesk Plus Cloud change and its associated notes.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    changeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the change to delete',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/changes/${safeUrlPathSegment(params.changeId, 'Change ID')}`,
    method: 'DELETE',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    await parseSdpResponse(response, 'Failed to delete change')
    return { success: true, output: { deleted: true } }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the change was deleted' },
  },
}
