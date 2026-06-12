import type { ToolConfig } from '@/tools/types'
import { VANTA_FRAMEWORK_DETAIL_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetFrameworkParams, VantaGetFrameworkResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaGetFrameworkTool: ToolConfig<VantaGetFrameworkParams, VantaGetFrameworkResponse> =
  {
    id: 'vanta_get_framework',
    name: 'Vanta Get Framework',
    description:
      'Get a Vanta compliance framework by ID, including its requirement categories and mapped controls',
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
      frameworkId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Unique ID of the framework (e.g., soc2)',
      },
    },

    request: {
      url: VANTA_QUERY_ROUTE,
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        operation: 'vanta_get_framework',
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        region: params.region,
        frameworkId: params.frameworkId,
      }),
    },

    transformResponse: createVantaTransformResponse<VantaGetFrameworkResponse>(
      'Failed to get Vanta framework'
    ),

    outputs: {
      framework: {
        type: 'json',
        description: 'The requested framework with requirement categories',
        properties: VANTA_FRAMEWORK_DETAIL_OUTPUT_PROPERTIES,
      },
    },
  }
