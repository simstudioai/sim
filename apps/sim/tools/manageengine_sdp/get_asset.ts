import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpGetAssetParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_ASSET_PROPERTIES } from '@/tools/manageengine_sdp/types'
import { buildSdpHeaders, getSdpApiBase, parseSdpResponse } from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpGetAssetTool: ToolConfig<SdpGetAssetParams, SdpResponse> = {
  id: 'manageengine_sdp_get_asset',
  name: 'ManageEngine SDP Get Asset',
  description: 'Retrieve a single ManageEngine ServiceDesk Plus Cloud asset by ID.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    assetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the asset to retrieve',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/assets/${safeUrlPathSegment(params.assetId, 'Asset ID')}`,
    method: 'GET',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to get asset')
    return { success: true, output: { asset: data.asset ?? null } }
  },

  outputs: {
    asset: {
      type: 'object',
      description: 'The asset',
      nullable: true,
      properties: SDP_ASSET_PROPERTIES,
    },
  },
}
