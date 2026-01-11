import type { ApolloEmailAccountsParams, ApolloEmailAccountsResponse } from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloEmailAccountsTool: ToolConfig<
  ApolloEmailAccountsParams,
  ApolloEmailAccountsResponse
> = {
  id: 'apollo_email_accounts',
  name: 'Apollo Get Email Accounts',
  description: "Get list of team's linked email accounts in Apollo",
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key (master key required)',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/email_accounts',
    method: 'GET',
    headers: (params: ApolloEmailAccountsParams) => ({
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
        email_accounts: data.email_accounts || [],
        total: data.email_accounts?.length || 0,
      },
    }
  },

  outputs: {
    email_accounts: { type: 'json', description: 'Array of team email accounts linked in Apollo' },
    total: { type: 'number', description: 'Total count of email accounts' },
  },
}
