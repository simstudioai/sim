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
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        region: params.region,
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
