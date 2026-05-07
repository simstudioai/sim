import type { ApolloAccountUpdateParams, ApolloAccountUpdateResponse } from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

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
      description: 'ID of the account to update (e.g., "acc_abc123")',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name (e.g., "Acme Corporation")',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain (e.g., "acme.com")',
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
    url: (params: ApolloAccountUpdateParams) =>
      `https://api.apollo.io/api/v1/accounts/${params.account_id.trim()}`,
    method: 'PATCH',
    headers: (params: ApolloAccountUpdateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloAccountUpdateParams) => {
      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
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
        updated: !!account,
      },
    }
  },

  outputs: {
    account: { type: 'json', description: 'Updated account data from Apollo', optional: true },
    updated: { type: 'boolean', description: 'Whether the account was successfully updated' },
  },
}
