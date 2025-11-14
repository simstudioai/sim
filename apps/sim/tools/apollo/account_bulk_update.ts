import type { ToolConfig } from '@/tools/types'
import type { ApolloAccountBulkUpdateParams, ApolloAccountBulkUpdateResponse } from './types'

export const apolloAccountBulkUpdateTool: ToolConfig<
  ApolloAccountBulkUpdateParams,
  ApolloAccountBulkUpdateResponse
> = {
  id: 'apollo_account_bulk_update',
  name: 'Apollo Bulk Update Accounts',
  description:
    'Update up to 1000 existing accounts at once in your Apollo database (higher limit than contacts!). Each account must include an id field. Master key required.',
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
        'Array of accounts to update (max 1000). Each account must include id field, and optionally name, website_url, phone, owner_id',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/accounts/bulk_update',
    method: 'POST',
    headers: (params: ApolloAccountBulkUpdateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloAccountBulkUpdateParams) => ({
      accounts: params.accounts.slice(0, 1000),
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
        updated_accounts: data.accounts || data.updated_accounts || [],
        failed_accounts: data.failed_accounts || [],
        metadata: {
          total_submitted: data.accounts?.length || 0,
          updated: data.updated_accounts?.length || data.accounts?.length || 0,
          failed: data.failed_accounts?.length || 0,
        },
      },
    }
  },

  outputs: {
    updated_accounts: {
      type: 'json',
      description: 'Array of successfully updated accounts',
    },
    failed_accounts: {
      type: 'json',
      description: 'Array of accounts that failed to update',
    },
    metadata: {
      type: 'json',
      description: 'Bulk update metadata including counts of updated and failed accounts',
    },
  },
}
