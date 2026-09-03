import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpGetChangeParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_CHANGE_PROPERTIES } from '@/tools/manageengine_sdp/types'
import { buildSdpHeaders, getSdpApiBase, parseSdpResponse } from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpGetChangeTool: ToolConfig<SdpGetChangeParams, SdpResponse> = {
  id: 'manageengine_sdp_get_change',
  name: 'ManageEngine SDP Get Change',
  description: 'Retrieve a single ManageEngine ServiceDesk Plus Cloud change by ID.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    changeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the change to retrieve',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/changes/${safeUrlPathSegment(params.changeId, 'Change ID')}`,
    method: 'GET',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to get change')
    return { success: true, output: { change: data.change ?? null } }
  },

  outputs: {
    change: {
      type: 'object',
      description: 'The change',
      nullable: true,
      properties: SDP_CHANGE_PROPERTIES,
    },
  },
}
