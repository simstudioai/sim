import { buildSdpAssetEntity } from '@/tools/manageengine_sdp/entity-builders'
import { SDP_ASSET_WRITE_PARAMS, SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpAssetWriteParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_ASSET_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpInputDataBody,
  getSdpApiBase,
  parseSdpResponse,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'

export const manageengineSdpCreateAssetTool: ToolConfig<SdpAssetWriteParams, SdpResponse> = {
  id: 'manageengine_sdp_create_asset',
  name: 'ManageEngine SDP Create Asset',
  description:
    'Create an asset in the ManageEngine ServiceDesk Plus Cloud inventory. Requires a name and an existing product.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    // name and product are the two fields ServiceDesk Plus documents as
    // mandatory on Add Asset. `product` must already exist in the portal.
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Asset name',
    },
    product: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of an existing product this asset is an instance of',
    },
    ...SDP_ASSET_WRITE_PARAMS,
  },

  request: {
    url: (params) => `${getSdpApiBase(params)}/assets`,
    method: 'POST',
    headers: (params) => buildSdpHeaders(params),
    body: (params) => buildSdpInputDataBody('asset', buildSdpAssetEntity(params)),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to create asset')
    return { success: true, output: { asset: data.asset ?? null } }
  },

  outputs: {
    asset: {
      type: 'object',
      description: 'The created asset',
      nullable: true,
      properties: SDP_ASSET_PROPERTIES,
    },
  },
}
