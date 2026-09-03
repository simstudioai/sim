import { buildSdpSolutionEntity } from '@/tools/manageengine_sdp/entity-builders'
import { SDP_BASE_PARAMS, SDP_SOLUTION_WRITE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpResponse, SdpSolutionWriteParams } from '@/tools/manageengine_sdp/types'
import { SDP_SOLUTION_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpInputDataBody,
  getSdpApiBase,
  parseSdpResponse,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'

export const manageengineSdpCreateSolutionTool: ToolConfig<SdpSolutionWriteParams, SdpResponse> = {
  id: 'manageengine_sdp_create_solution',
  name: 'ManageEngine SDP Create Solution',
  description:
    'Add an article to the ManageEngine ServiceDesk Plus Cloud knowledge base under an existing topic.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    // title, description and topic are the three fields ServiceDesk Plus
    // documents as mandatory on Add Solution. The topic must already exist.
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Solution title',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Solution body. HTML is supported',
    },
    topic: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of an existing knowledge base topic to file the solution under',
    },
    ...SDP_SOLUTION_WRITE_PARAMS,
  },

  request: {
    url: (params) => `${getSdpApiBase(params)}/solutions`,
    method: 'POST',
    headers: (params) => buildSdpHeaders(params),
    body: (params) => buildSdpInputDataBody('solution', buildSdpSolutionEntity(params)),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to create solution')
    return { success: true, output: { solution: data.solution ?? null } }
  },

  outputs: {
    solution: {
      type: 'object',
      description: 'The created solution',
      nullable: true,
      properties: SDP_SOLUTION_PROPERTIES,
    },
  },
}
