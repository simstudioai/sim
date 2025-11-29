import type {
  ApolloOpportunityUpdateParams,
  ApolloOpportunityUpdateResponse,
} from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloOpportunityUpdateTool: ToolConfig<
  ApolloOpportunityUpdateParams,
  ApolloOpportunityUpdateResponse
> = {
  id: 'apollo_opportunity_update',
  name: 'Apollo Update Opportunity',
  description: 'Update an existing deal/opportunity in your Apollo database',
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
      description: 'ID of the opportunity to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the opportunity/deal',
    },
    amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Monetary value of the opportunity',
    },
    stage_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the deal stage',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User ID of the opportunity owner',
    },
    close_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expected close date (ISO 8601 format)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description or notes about the opportunity',
    },
  },

  request: {
    url: (params: ApolloOpportunityUpdateParams) =>
      `https://api.apollo.io/api/v1/opportunities/${params.opportunity_id}`,
    method: 'PATCH',
    headers: (params: ApolloOpportunityUpdateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloOpportunityUpdateParams) => {
      const body: any = {}
      if (params.name) body.name = params.name
      if (params.amount !== undefined) body.amount = params.amount
      if (params.stage_id) body.stage_id = params.stage_id
      if (params.owner_id) body.owner_id = params.owner_id
      if (params.close_date) body.close_date = params.close_date
      if (params.description) body.description = params.description
      return body
    },
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
          updated: !!data.opportunity,
        },
      },
    }
  },

  outputs: {
    opportunity: { type: 'json', description: 'Updated opportunity data from Apollo' },
    metadata: { type: 'json', description: 'Update metadata including updated status' },
  },
}
