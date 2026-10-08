import type { InternalToolConfig } from '@/tools/types'
import { VANTA_VULNERABLE_ASSET_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type {
  VantaGetVulnerableAssetParams,
  VantaGetVulnerableAssetResponse,
} from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaGetVulnerableAssetTool: InternalToolConfig<
  VantaGetVulnerableAssetParams,
  VantaGetVulnerableAssetResponse
> = {
  id: 'vanta_get_vulnerable_asset',
  name: 'Vanta Get Vulnerable Asset',
  description:
    'Get a vulnerable asset in Vanta by ID, including the scanners reporting it and per-scanner asset details',
  version: '1.0.0',

  oauth: { required: true, provider: 'vanta', authoritativeParams: ['apiDomain'] },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token supplied by the saved Vanta credential',
    },
    apiDomain: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'API origin supplied by the saved Vanta credential',
    },
    vulnerableAssetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the vulnerable asset',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'vanta_get_vulnerable_asset',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
      vulnerableAssetId: params.vulnerableAssetId,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaGetVulnerableAssetResponse>(
    'Failed to get Vanta vulnerable asset'
  ),

  outputs: {
    asset: {
      type: 'json',
      description: 'The requested vulnerable asset',
      properties: VANTA_VULNERABLE_ASSET_OUTPUT_PROPERTIES,
    },
  },
}
