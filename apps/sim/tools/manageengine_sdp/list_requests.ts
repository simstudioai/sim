import { SDP_BASE_PARAMS, SDP_LIST_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpListParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_LIST_INFO_PROPERTIES, SDP_REQUEST_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpListUrl,
  getSdpApiBase,
  parseSdpResponse,
  readSdpList,
  readSdpListInfo,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'

export const manageengineSdpListRequestsTool: ToolConfig<SdpListParams, SdpResponse> = {
  id: 'manageengine_sdp_list_requests',
  name: 'ManageEngine SDP List Requests',
  description:
    'List ManageEngine ServiceDesk Plus Cloud requests, with optional search criteria, sorting and paging.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: { ...SDP_BASE_PARAMS, ...SDP_LIST_PARAMS },

  request: {
    url: (params) => buildSdpListUrl(`${getSdpApiBase(params)}/requests`, params),
    method: 'GET',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to list requests')
    const requests = readSdpList(data, 'requests')
    return {
      success: true,
      output: {
        requests,
        count: requests.length,
        listInfo: readSdpListInfo(data) ?? null,
      },
    }
  },

  outputs: {
    requests: {
      type: 'array',
      description: 'Matching requests',
      items: { type: 'object', properties: SDP_REQUEST_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of requests returned in this page' },
    listInfo: {
      type: 'object',
      description: 'Paging metadata echoed by ServiceDesk Plus',
      optional: true,
      nullable: true,
      properties: SDP_LIST_INFO_PROPERTIES,
    },
  },
}
