import { buildSdpProblemEntity } from '@/tools/manageengine_sdp/entity-builders'
import { SDP_BASE_PARAMS, SDP_PROBLEM_WRITE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpResponse, SdpUpdateProblemParams } from '@/tools/manageengine_sdp/types'
import { SDP_PROBLEM_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpInputDataBody,
  getSdpApiBase,
  parseSdpResponse,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpUpdateProblemTool: ToolConfig<SdpUpdateProblemParams, SdpResponse> = {
  id: 'manageengine_sdp_update_problem',
  name: 'ManageEngine SDP Update Problem',
  description:
    'Update a ManageEngine ServiceDesk Plus Cloud problem: change its title, status, assignment or classification.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    problemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the problem to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New problem title',
    },
    ...SDP_PROBLEM_WRITE_PARAMS,
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/problems/${safeUrlPathSegment(params.problemId, 'Problem ID')}`,
    method: 'PUT',
    headers: (params) => buildSdpHeaders(params),
    body: (params) => buildSdpInputDataBody('problem', buildSdpProblemEntity(params)),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to update problem')
    return { success: true, output: { problem: data.problem ?? null } }
  },

  outputs: {
    problem: {
      type: 'object',
      description: 'The updated problem',
      nullable: true,
      properties: SDP_PROBLEM_PROPERTIES,
    },
  },
}
