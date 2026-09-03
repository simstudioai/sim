import { SDP_BASE_PARAMS, SDP_LIST_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpListParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_CHANGE_PROPERTIES, SDP_LIST_INFO_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpListUrl,
  getSdpApiBase,
  parseSdpResponse,
  readSdpList,
  readSdpListInfo,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'

export const manageengineSdpListChangesTool: ToolConfig<SdpListParams, SdpResponse> = {
  id: 'manageengine_sdp_list_changes',
  name: 'ManageEngine SDP List Changes',
  description:
    'List ManageEngine ServiceDesk Plus Cloud changes, with optional search criteria, sorting and paging.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: { ...SDP_BASE_PARAMS, ...SDP_LIST_PARAMS },

  request: {
    url: (params) => buildSdpListUrl(`${getSdpApiBase(params)}/changes`, params),
    method: 'GET',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to list changes')
    const changes = readSdpList(data, 'changes')
    return {
      success: true,
      output: { changes, count: changes.length, listInfo: readSdpListInfo(data) ?? null },
    }
  },

  outputs: {
    changes: {
      type: 'array',
      description: 'Matching changes',
      items: { type: 'object', properties: SDP_CHANGE_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of changes returned in this page' },
    listInfo: {
      type: 'object',
      description: 'Paging metadata echoed by ServiceDesk Plus',
      optional: true,
      nullable: true,
      properties: SDP_LIST_INFO_PROPERTIES,
    },
  },
}
