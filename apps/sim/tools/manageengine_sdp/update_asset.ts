import { buildSdpAssetEntity } from '@/tools/manageengine_sdp/entity-builders'
import { SDP_ASSET_WRITE_PARAMS, SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpResponse, SdpUpdateAssetParams } from '@/tools/manageengine_sdp/types'
import { SDP_ASSET_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpInputDataBody,
  getSdpApiBase,
  parseSdpResponse,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpUpdateAssetTool: ToolConfig<SdpUpdateAssetParams, SdpResponse> = {
  id: 'manageengine_sdp_update_asset',
  name: 'ManageEngine SDP Update Asset',
  description:
    'Update a ManageEngine ServiceDesk Plus Cloud asset: reassign it, change its state, or correct its inventory details.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    assetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the asset to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New asset name',
    },
    product: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of an existing product to reassign the asset to',
    },
    ...SDP_ASSET_WRITE_PARAMS,
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/assets/${safeUrlPathSegment(params.assetId, 'Asset ID')}`,
    method: 'PUT',
    headers: (params) => buildSdpHeaders(params),
    body: (params) => buildSdpInputDataBody('asset', buildSdpAssetEntity(params)),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to update asset')
    return { success: true, output: { asset: data.asset ?? null } }
  },

  outputs: {
    asset: {
      type: 'object',
      description: 'The updated asset',
      nullable: true,
      properties: SDP_ASSET_PROPERTIES,
    },
  },
}
