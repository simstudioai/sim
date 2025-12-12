import type {
  ApolloOpportunityCreateParams,
  ApolloOpportunityCreateResponse,
} from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloOpportunityCreateTool: ToolConfig<
  ApolloOpportunityCreateParams,
  ApolloOpportunityCreateResponse
> = {
  id: 'apollo_opportunity_create',
  name: 'Apollo Create Opportunity',
  description: 'Create a new deal for an account in your Apollo database (master key required)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key (master key required)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the opportunity/deal',
    },
    account_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the account this opportunity belongs to',
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
    url: 'https://api.apollo.io/api/v1/opportunities',
    method: 'POST',
    headers: (params: ApolloOpportunityCreateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloOpportunityCreateParams) => {
      const body: any = {
        name: params.name,
        account_id: params.account_id,
      }
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
          created: !!data.opportunity,
        },
      },
    }
  },

  outputs: {
    opportunity: { type: 'json', description: 'Created opportunity data from Apollo' },
    metadata: { type: 'json', description: 'Creation metadata including created status' },
  },
}
