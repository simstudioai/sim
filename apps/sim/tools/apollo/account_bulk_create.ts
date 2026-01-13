import type {
  ApolloAccountBulkCreateParams,
  ApolloAccountBulkCreateResponse,
} from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloAccountBulkCreateTool: ToolConfig<
  ApolloAccountBulkCreateParams,
  ApolloAccountBulkCreateResponse
> = {
  id: 'apollo_account_bulk_create',
  name: 'Apollo Bulk Create Accounts',
  description:
    'Create up to 100 accounts at once in your Apollo database. Note: Apollo does not apply deduplication - duplicate accounts may be created if entries share similar names or domains. Master key required.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key (master key required)',
    },
    accounts: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of accounts to create (max 100). Each account should include name (required), and optionally website_url, phone, owner_id',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/accounts/bulk_create',
    method: 'POST',
    headers: (params: ApolloAccountBulkCreateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloAccountBulkCreateParams) => ({
      accounts: params.accounts.slice(0, 100),
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
        created_accounts: data.accounts || data.created_accounts || [],
        failed_accounts: data.failed_accounts || [],
        total_submitted: data.accounts?.length || 0,
        created: data.created_accounts?.length || data.accounts?.length || 0,
        failed: data.failed_accounts?.length || 0,
      },
    }
  },

  outputs: {
    created_accounts: {
      type: 'json',
      description: 'Array of newly created accounts',
    },
    failed_accounts: {
      type: 'json',
      description: 'Array of accounts that failed to create',
    },
    total_submitted: {
      type: 'number',
      description: 'Total number of accounts submitted',
    },
    created: {
      type: 'number',
      description: 'Number of accounts successfully created',
    },
    failed: {
      type: 'number',
      description: 'Number of accounts that failed to create',
    },
  },
}
