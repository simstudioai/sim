import { SDP_BASE_PARAMS, SDP_LIST_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpListParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_LIST_INFO_PROPERTIES, SDP_PROBLEM_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpListUrl,
  getSdpApiBase,
  parseSdpResponse,
  readSdpList,
  readSdpListInfo,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'

export const manageengineSdpListProblemsTool: ToolConfig<SdpListParams, SdpResponse> = {
  id: 'manageengine_sdp_list_problems',
  name: 'ManageEngine SDP List Problems',
  description:
    'List ManageEngine ServiceDesk Plus Cloud problems, with optional search criteria, sorting and paging.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: { ...SDP_BASE_PARAMS, ...SDP_LIST_PARAMS },

  request: {
    url: (params) => buildSdpListUrl(`${getSdpApiBase(params)}/problems`, params),
    method: 'GET',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to list problems')
    const problems = readSdpList(data, 'problems')
    return {
      success: true,
      output: { problems, count: problems.length, listInfo: readSdpListInfo(data) ?? null },
    }
  },

  outputs: {
    problems: {
      type: 'array',
      description: 'Matching problems',
      items: { type: 'object', properties: SDP_PROBLEM_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of problems returned in this page' },
    listInfo: {
      type: 'object',
      description: 'Paging metadata echoed by ServiceDesk Plus',
      optional: true,
      nullable: true,
      properties: SDP_LIST_INFO_PROPERTIES,
    },
  },
}
