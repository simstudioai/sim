import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpDeleteSolutionParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { buildSdpHeaders, getSdpApiBase, parseSdpResponse } from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpDeleteSolutionTool: ToolConfig<SdpDeleteSolutionParams, SdpResponse> = {
  id: 'manageengine_sdp_delete_solution',
  name: 'ManageEngine SDP Delete Solution',
  description:
    'Delete an article from the ManageEngine ServiceDesk Plus Cloud knowledge base, along with its comments and versions.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    solutionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the solution to delete',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/solutions/${safeUrlPathSegment(params.solutionId, 'Solution ID')}`,
    method: 'DELETE',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    await parseSdpResponse(response, 'Failed to delete solution')
    return { success: true, output: { deleted: true } }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the solution was deleted' },
  },
}
