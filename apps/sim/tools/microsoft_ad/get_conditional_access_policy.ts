import type {
  MicrosoftAdGetConditionalAccessPolicyParams,
  MicrosoftAdGetConditionalAccessPolicyResponse,
} from '@/tools/microsoft_ad/types'
import { CONDITIONAL_ACCESS_POLICY_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { mapConditionalAccessPolicy } from '@/tools/microsoft_ad/utils'
import type { ToolConfig } from '@/tools/types'

export const getConditionalAccessPolicyTool: ToolConfig<
  MicrosoftAdGetConditionalAccessPolicyParams,
  MicrosoftAdGetConditionalAccessPolicyResponse
> = {
  id: 'microsoft_ad_get_conditional_access_policy',
  name: 'Get Microsoft Entra ID Conditional Access Policy',
  description:
    'Get a single conditional access policy by ID, including the conditions it matches and the controls it enforces. Read-only.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',
  oauth: {
    required: true,
    provider: 'microsoft-ad',
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Microsoft Graph API access token',
    },
    policyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Conditional access policy ID',
    },
  },
  request: {
    url: (params) => {
      const policyId = params.policyId?.trim()
      if (!policyId) throw new Error('Policy ID is required')
      return `https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies/${encodeURIComponent(policyId)}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const policy = await response.json()
    return {
      success: true,
      output: {
        policy: mapConditionalAccessPolicy(policy),
      },
    }
  },
  outputs: {
    policy: {
      type: 'object',
      description: 'Conditional access policy details',
      properties: CONDITIONAL_ACCESS_POLICY_OUTPUT_PROPERTIES,
    },
  },
}
