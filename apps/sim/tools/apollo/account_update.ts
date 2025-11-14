import type { ToolConfig } from '@/tools/types'
import type { ApolloAccountUpdateParams, ApolloAccountUpdateResponse } from './types'

export const apolloAccountUpdateTool: ToolConfig<
  ApolloAccountUpdateParams,
  ApolloAccountUpdateResponse
> = {
  id: 'apollo_account_update',
  name: 'Apollo Update Account',
  description: 'Update an existing account in your Apollo database',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key',
    },
    account_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the account to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name',
    },
    website_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company website URL',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company phone number',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User ID of the account owner',
    },
  },

  request: {
    url: (params: ApolloAccountUpdateParams) =>
      `https://api.apollo.io/api/v1/accounts/${params.account_id}`,
    method: 'PATCH',
    headers: (params: ApolloAccountUpdateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloAccountUpdateParams) => {
      const body: any = {}
      if (params.name) body.name = params.name
      if (params.website_url) body.website_url = params.website_url
      if (params.phone) body.phone = params.phone
      if (params.owner_id) body.owner_id = params.owner_id
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
        account: data.account || {},
        metadata: {
          updated: !!data.account,
        },
      },
    }
  },

  outputs: {
    account: { type: 'json', description: 'Updated account data from Apollo' },
    metadata: { type: 'json', description: 'Update metadata including updated status' },
  },
}
