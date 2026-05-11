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
      description: 'ID of the opportunity to update (e.g., "opp_abc123")',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the opportunity/deal (e.g., "Enterprise License - Q1")',
    },
    amount: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Monetary value as a plain number string with no commas or currency symbols',
    },
    opportunity_stage_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the opportunity stage',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User ID of the opportunity owner',
    },
    closed_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expected close date in YYYY-MM-DD format',
    },
    typed_custom_fields: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Custom field values as { custom_field_id: value } map',
    },
  },

  request: {
    url: (params: ApolloOpportunityUpdateParams) =>
      `https://api.apollo.io/api/v1/opportunities/${params.opportunity_id.trim()}`,
    method: 'PATCH',
    headers: (params: ApolloOpportunityUpdateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloOpportunityUpdateParams) => {
      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.amount !== undefined && params.amount !== null && params.amount !== '') {
        body.amount = String(params.amount)
      }
      if (params.opportunity_stage_id) body.opportunity_stage_id = params.opportunity_stage_id
      if (params.owner_id) body.owner_id = params.owner_id
      if (params.closed_date) body.closed_date = params.closed_date
      if (params.typed_custom_fields) body.typed_custom_fields = params.typed_custom_fields
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const opportunity = data.opportunity ?? (data.id ? data : null)

    return {
      success: true,
      output: {
        opportunity,
        updated: !!opportunity,
      },
    }
  },

  outputs: {
    opportunity: {
      type: 'json',
      description: 'Updated opportunity data from Apollo',
      optional: true,
    },
    updated: { type: 'boolean', description: 'Whether the opportunity was successfully updated' },
  },
}
