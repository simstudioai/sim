import { SDP_BASE_PARAMS, SDP_LIST_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpListParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_LIST_INFO_PROPERTIES, SDP_SOLUTION_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpListUrl,
  getSdpApiBase,
  parseSdpResponse,
  readSdpList,
  readSdpListInfo,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'

export const manageengineSdpListSolutionsTool: ToolConfig<SdpListParams, SdpResponse> = {
  id: 'manageengine_sdp_list_solutions',
  name: 'ManageEngine SDP List Solutions',
  description:
    'Search the ManageEngine ServiceDesk Plus Cloud knowledge base, with optional search criteria, sorting and paging.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: { ...SDP_BASE_PARAMS, ...SDP_LIST_PARAMS },

  request: {
    url: (params) => buildSdpListUrl(`${getSdpApiBase(params)}/solutions`, params),
    method: 'GET',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to list solutions')
    const solutions = readSdpList(data, 'solutions')
    return {
      success: true,
      output: { solutions, count: solutions.length, listInfo: readSdpListInfo(data) ?? null },
    }
  },

  outputs: {
    solutions: {
      type: 'array',
      description: 'Matching solutions',
      items: { type: 'object', properties: SDP_SOLUTION_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of solutions returned in this page' },
    listInfo: {
      type: 'object',
      description: 'Paging metadata echoed by ServiceDesk Plus',
      optional: true,
      nullable: true,
      properties: SDP_LIST_INFO_PROPERTIES,
    },
  },
}
