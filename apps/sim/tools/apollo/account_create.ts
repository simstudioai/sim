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
      description: 'Apollo API key (master key required)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company name (e.g., "Acme Corporation")',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain without www. prefix (e.g., "acme.com")',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary phone number for the account',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Apollo user ID of the account owner',
    },
    account_stage_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Apollo ID for the account stage to assign this account to',
    },
    raw_address: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Corporate location (e.g., "San Francisco, CA, USA")',
    },
    typed_custom_fields: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Custom field values as { custom_field_id: value } map',
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
      const body: Record<string, unknown> = { name: params.name }
      if (params.domain) body.domain = params.domain
      if (params.phone) body.phone = params.phone
      if (params.owner_id) body.owner_id = params.owner_id
      if (params.account_stage_id) body.account_stage_id = params.account_stage_id
      if (params.raw_address) body.raw_address = params.raw_address
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
    const account = data.account ?? (data.id ? data : null)

    return {
      success: true,
      output: {
        account,
        created: !!account,
      },
    }
  },

  outputs: {
    account: { type: 'json', description: 'Created account data from Apollo', optional: true },
    created: { type: 'boolean', description: 'Whether the account was successfully created' },
  },
}
