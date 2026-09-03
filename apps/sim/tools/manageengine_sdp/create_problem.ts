import { buildSdpProblemEntity } from '@/tools/manageengine_sdp/entity-builders'
import { SDP_BASE_PARAMS, SDP_PROBLEM_WRITE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpProblemWriteParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_PROBLEM_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpInputDataBody,
  getSdpApiBase,
  parseSdpResponse,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'

export const manageengineSdpCreateProblemTool: ToolConfig<SdpProblemWriteParams, SdpResponse> = {
  id: 'manageengine_sdp_create_problem',
  name: 'ManageEngine SDP Create Problem',
  description:
    'Create a problem record in ManageEngine ServiceDesk Plus Cloud with a title, description and classification.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Problem title',
    },
    ...SDP_PROBLEM_WRITE_PARAMS,
  },

  request: {
    url: (params) => `${getSdpApiBase(params)}/problems`,
    method: 'POST',
    headers: (params) => buildSdpHeaders(params),
    body: (params) => buildSdpInputDataBody('problem', buildSdpProblemEntity(params)),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to create problem')
    return { success: true, output: { problem: data.problem ?? null } }
  },

  outputs: {
    problem: {
      type: 'object',
      description: 'The created problem',
      nullable: true,
      properties: SDP_PROBLEM_PROPERTIES,
    },
  },
}
