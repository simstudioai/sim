import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpDeleteAssetParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { buildSdpHeaders, getSdpApiBase, parseSdpResponse } from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpDeleteAssetTool: ToolConfig<SdpDeleteAssetParams, SdpResponse> = {
  id: 'manageengine_sdp_delete_asset',
  name: 'ManageEngine SDP Delete Asset',
  description: 'Delete an asset from the ManageEngine ServiceDesk Plus Cloud inventory.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    assetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the asset to delete',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/assets/${safeUrlPathSegment(params.assetId, 'Asset ID')}`,
    method: 'DELETE',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    await parseSdpResponse(response, 'Failed to delete asset')
    return { success: true, output: { deleted: true } }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the asset was deleted' },
  },
}
