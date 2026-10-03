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

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client secret',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vanta API region: "us" (api.vanta.com, default) or "gov" (api.vanta-gov.com)',
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
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
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
