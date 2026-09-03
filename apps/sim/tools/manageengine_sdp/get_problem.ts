import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpGetProblemParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_PROBLEM_PROPERTIES } from '@/tools/manageengine_sdp/types'
import { buildSdpHeaders, getSdpApiBase, parseSdpResponse } from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpGetProblemTool: ToolConfig<SdpGetProblemParams, SdpResponse> = {
  id: 'manageengine_sdp_get_problem',
  name: 'ManageEngine SDP Get Problem',
  description: 'Retrieve a single ManageEngine ServiceDesk Plus Cloud problem by ID.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    problemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the problem to retrieve',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/problems/${safeUrlPathSegment(params.problemId, 'Problem ID')}`,
    method: 'GET',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to get problem')
    return { success: true, output: { problem: data.problem ?? null } }
  },

  outputs: {
    problem: {
      type: 'object',
      description: 'The problem',
      nullable: true,
      properties: SDP_PROBLEM_PROPERTIES,
    },
  },
}
