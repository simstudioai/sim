import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpGetSolutionParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_SOLUTION_PROPERTIES } from '@/tools/manageengine_sdp/types'
import { buildSdpHeaders, getSdpApiBase, parseSdpResponse } from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpGetSolutionTool: ToolConfig<SdpGetSolutionParams, SdpResponse> = {
  id: 'manageengine_sdp_get_solution',
  name: 'ManageEngine SDP Get Solution',
  description:
    'Retrieve a single ManageEngine ServiceDesk Plus Cloud knowledge base solution by ID.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    solutionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the solution to retrieve',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/solutions/${safeUrlPathSegment(params.solutionId, 'Solution ID')}`,
    method: 'GET',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to get solution')
    return { success: true, output: { solution: data.solution ?? null } }
  },

  outputs: {
    solution: {
      type: 'object',
      description: 'The solution',
      nullable: true,
      properties: SDP_SOLUTION_PROPERTIES,
    },
  },
}
