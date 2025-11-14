import type { ToolConfig } from '@/tools/types'
import type { ApolloOpportunityGetParams, ApolloOpportunityGetResponse } from './types'

export const apolloOpportunityGetTool: ToolConfig<
  ApolloOpportunityGetParams,
  ApolloOpportunityGetResponse
> = {
  id: 'apollo_opportunity_get',
  name: 'Apollo Get Opportunity',
  description: 'Retrieve complete details of a specific deal/opportunity by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key',
    },
    opportunity_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the opportunity to retrieve',
    },
  },

  request: {
    url: (params: ApolloOpportunityGetParams) =>
      `https://api.apollo.io/api/v1/opportunities/${params.opportunity_id}`,
    method: 'GET',
    headers: (params: ApolloOpportunityGetParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
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
        opportunity: data.opportunity || {},
        metadata: {
          found: !!data.opportunity,
        },
      },
    }
  },

  outputs: {
    opportunity: { type: 'json', description: 'Complete opportunity data from Apollo' },
    metadata: { type: 'json', description: 'Retrieval metadata including found status' },
  },
}
