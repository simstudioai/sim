import type { ApolloAccountCreateParams, ApolloAccountCreateResponse } from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloAccountCreateTool: ToolConfig<
  ApolloAccountCreateParams,
  ApolloAccountCreateResponse
> = {
  id: 'apollo_account_create',
  name: 'Apollo Create Account',
  description: 'Create a new account (company) in your Apollo database',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key',
    },
    name: {
      type: 'string',
      required: true,
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
    url: 'https://api.apollo.io/api/v1/accounts',
    method: 'POST',
    headers: (params: ApolloAccountCreateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloAccountCreateParams) => {
      const body: any = { name: params.name }
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
          created: !!data.account,
        },
      },
    }
  },

  outputs: {
    account: { type: 'json', description: 'Created account data from Apollo' },
    metadata: { type: 'json', description: 'Creation metadata including created status' },
  },
}
