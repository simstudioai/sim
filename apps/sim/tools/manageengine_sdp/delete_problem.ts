import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpDeleteProblemParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { buildSdpHeaders, getSdpApiBase, parseSdpResponse } from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpDeleteProblemTool: ToolConfig<SdpDeleteProblemParams, SdpResponse> = {
  id: 'manageengine_sdp_delete_problem',
  name: 'ManageEngine SDP Delete Problem',
  description: 'Delete a ManageEngine ServiceDesk Plus Cloud problem and its associated notes.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    problemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the problem to delete',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/problems/${safeUrlPathSegment(params.problemId, 'Problem ID')}`,
    method: 'DELETE',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    await parseSdpResponse(response, 'Failed to delete problem')
    return { success: true, output: { deleted: true } }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the problem was deleted' },
  },
}
