import type { InternalToolConfig } from '@/tools/types'
import { VANTA_FRAMEWORK_DETAIL_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetFrameworkParams, VantaGetFrameworkResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaGetFrameworkTool: InternalToolConfig<
  VantaGetFrameworkParams,
  VantaGetFrameworkResponse
> = {
  id: 'vanta_get_framework',
  name: 'Vanta Get Framework',
  description:
    'Get a Vanta compliance framework by ID, including its requirement categories and mapped controls',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'vanta',
    credentialKind: 'service-account',
    authoritativeParams: ['apiDomain'],
    retryOnUnauthorized: true,
  },

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
    frameworkId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the framework (e.g., soc2)',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'vanta_get_framework',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
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
