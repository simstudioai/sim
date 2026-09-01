import type {
  MicrosoftAdListConditionalAccessPoliciesParams,
  MicrosoftAdListConditionalAccessPoliciesResponse,
} from '@/tools/microsoft_ad/types'
import { CONDITIONAL_ACCESS_POLICY_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import {
  assertGraphNextPageUrlForCollection,
  buildGraphCollectionUrl,
  mapConditionalAccessPolicy,
} from '@/tools/microsoft_ad/utils'
import { getGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const listConditionalAccessPoliciesTool: ToolConfig<
  MicrosoftAdListConditionalAccessPoliciesParams,
  MicrosoftAdListConditionalAccessPoliciesResponse
> = {
  id: 'microsoft_ad_list_conditional_access_policies',
  name: 'List Microsoft Entra ID Conditional Access Policies',
  description:
    'List the conditional access policies configured in the tenant, including their state and the conditions and controls they enforce. Read-only.',
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
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of policies to return',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `OData filter expression. Example: "state eq 'enabled'".`,
    },
    nextLink: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Continuation URL from a previous response's 'nextLink' output, used to fetch the next page of results",
    },
  },
  request: {
    url: (params) => {
      if (params.nextLink) return assertGraphNextPageUrlForCollection(params.nextLink, ['policies'])
      return buildGraphCollectionUrl('identity/conditionalAccess/policies', {
        top: params.top,
        filter: params.filter,
      })
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const policies = (data.value ?? []).map(mapConditionalAccessPolicy)
    return {
      success: true,
      output: {
        policies,
        policyCount: policies.length,
        nextLink: getGraphNextPageUrl(data) ?? null,
      },
    }
  },
  outputs: {
    policies: {
      type: 'array',
      description: 'Conditional access policies',
      items: {
        type: 'object',
        properties: CONDITIONAL_ACCESS_POLICY_OUTPUT_PROPERTIES,
      },
    },
    policyCount: { type: 'number', description: 'Number of policies returned' },
    nextLink: {
      type: 'string',
      description: 'Continuation URL for the next page of results, or null if there are no more',
      optional: true,
    },
  },
}
