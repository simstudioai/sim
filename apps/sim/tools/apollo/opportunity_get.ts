import type { ApolloOpportunityGetParams, ApolloOpportunityGetResponse } from '@/tools/apollo/types'
import { getApolloAuthHeaders } from '@/tools/apollo/utils'
import { APOLLO_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const apolloOpportunityGetTool: ToolConfig<
  ApolloOpportunityGetParams,
  ApolloOpportunityGetResponse
> = {
  id: 'apollo_opportunity_get',
  name: 'Apollo Get Opportunity',
  description: 'Retrieve complete details of a specific deal/opportunity by ID',
  version: '1.0.0',
  oauth: APOLLO_CREDENTIAL_OAUTH,

  params: {
    credentialType: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Stored credential type supplied by credential resolution',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Apollo API key',
    },
    opportunity_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the opportunity to retrieve (e.g., "opp_abc123")',
    },
  },

  request: {
    url: (params: ApolloOpportunityGetParams) =>
      `https://api.apollo.io/api/v1/opportunities/${params.opportunity_id.trim()}`,
    method: 'GET',
    headers: (params: ApolloOpportunityGetParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...getApolloAuthHeaders(params),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        opportunity: data.opportunity ?? null,
        found: !!data.opportunity,
      },
    }
  },

  outputs: {
    opportunity: {
      type: 'json',
      description: 'Complete opportunity data from Apollo',
      optional: true,
    },
    found: { type: 'boolean', description: 'Whether the opportunity was found' },
  },
}
