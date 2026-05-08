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
      description: 'Name of the opportunity/deal (e.g., "Enterprise License - Q1")',
    },
    account_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the account this opportunity belongs to (e.g., "acc_abc123")',
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
    url: 'https://api.apollo.io/api/v1/opportunities',
    method: 'POST',
    headers: (params: ApolloOpportunityCreateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloOpportunityCreateParams) => {
      const body: Record<string, unknown> = { name: params.name }
      if (params.account_id) body.account_id = params.account_id
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
        created: !!opportunity,
      },
    }
  },

  outputs: {
    opportunity: {
      type: 'json',
      description: 'Created opportunity data from Apollo',
      optional: true,
    },
    created: { type: 'boolean', description: 'Whether the opportunity was successfully created' },
  },
}
