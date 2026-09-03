import { buildSdpSolutionEntity } from '@/tools/manageengine_sdp/entity-builders'
import { SDP_BASE_PARAMS, SDP_SOLUTION_WRITE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpResponse, SdpUpdateSolutionParams } from '@/tools/manageengine_sdp/types'
import { SDP_SOLUTION_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpInputDataBody,
  getSdpApiBase,
  parseSdpResponse,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpUpdateSolutionTool: ToolConfig<SdpUpdateSolutionParams, SdpResponse> = {
  id: 'manageengine_sdp_update_solution',
  name: 'ManageEngine SDP Update Solution',
  description:
    'Update a ManageEngine ServiceDesk Plus Cloud knowledge base solution: revise its body, retitle it, or move it to another topic.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    solutionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the solution to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New solution title',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New solution body. HTML is supported',
    },
    topic: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of an existing topic to move the solution to',
    },
    ...SDP_SOLUTION_WRITE_PARAMS,
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/solutions/${safeUrlPathSegment(params.solutionId, 'Solution ID')}`,
    method: 'PUT',
    headers: (params) => buildSdpHeaders(params),
    body: (params) => buildSdpInputDataBody('solution', buildSdpSolutionEntity(params)),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to update solution')
    return { success: true, output: { solution: data.solution ?? null } }
  },

  outputs: {
    solution: {
      type: 'object',
      description: 'The updated solution',
      nullable: true,
      properties: SDP_SOLUTION_PROPERTIES,
    },
  },
}
