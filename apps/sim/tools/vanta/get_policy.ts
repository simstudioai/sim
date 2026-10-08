import type { InternalToolConfig } from '@/tools/types'
import { VANTA_POLICY_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetPolicyParams, VantaGetPolicyResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaGetPolicyTool: InternalToolConfig<VantaGetPolicyParams, VantaGetPolicyResponse> =
  {
    id: 'vanta_get_policy',
    name: 'Vanta Get Policy',
    description:
      'Get a Vanta security policy by ID, including its approval status and latest approved version documents',
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
      policyId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Unique ID of the policy',
      },
    },

    operation: {
      input: (params) => ({
        operation: 'vanta_get_policy',
        accessToken: params.accessToken,
        apiDomain: params.apiDomain,
        policyId: params.policyId,
      }),
    },

    transformResponse: createVantaTransformResponse<VantaGetPolicyResponse>(
      'Failed to get Vanta policy'
    ),

    outputs: {
      policy: {
        type: 'json',
        description: 'The requested policy',
        properties: VANTA_POLICY_OUTPUT_PROPERTIES,
      },
    },
  }
