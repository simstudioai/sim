import { SDP_BASE_PARAMS, SDP_LIST_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpListParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_ASSET_PROPERTIES, SDP_LIST_INFO_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpListUrl,
  getSdpApiBase,
  parseSdpResponse,
  readSdpList,
  readSdpListInfo,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'

export const manageengineSdpListAssetsTool: ToolConfig<SdpListParams, SdpResponse> = {
  id: 'manageengine_sdp_list_assets',
  name: 'ManageEngine SDP List Assets',
  description:
    'List ManageEngine ServiceDesk Plus Cloud assets, with optional search criteria, sorting and paging.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: { ...SDP_BASE_PARAMS, ...SDP_LIST_PARAMS },

  request: {
    url: (params) => buildSdpListUrl(`${getSdpApiBase(params)}/assets`, params),
    method: 'GET',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to list assets')
    const assets = readSdpList(data, 'assets')
    return {
      success: true,
      output: { assets, count: assets.length, listInfo: readSdpListInfo(data) ?? null },
    }
  },

  outputs: {
    assets: {
      type: 'array',
      description: 'Matching assets',
      items: { type: 'object', properties: SDP_ASSET_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of assets returned in this page' },
    listInfo: {
      type: 'object',
      description: 'Paging metadata echoed by ServiceDesk Plus',
      optional: true,
      nullable: true,
      properties: SDP_LIST_INFO_PROPERTIES,
    },
  },
}
