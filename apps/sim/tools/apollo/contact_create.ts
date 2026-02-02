import type { ApolloContactCreateParams, ApolloContactCreateResponse } from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloContactCreateTool: ToolConfig<
  ApolloContactCreateParams,
  ApolloContactCreateResponse
> = {
  id: 'apollo_contact_create',
  name: 'Apollo Create Contact',
  description: 'Create a new contact in your Apollo database',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key',
    },
    first_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'First name of the contact',
    },
    last_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Last name of the contact',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the contact',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job title (e.g., "VP of Sales", "Software Engineer")',
    },
    account_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Apollo account ID to associate with (e.g., "acc_abc123")',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User ID of the contact owner',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/contacts',
    method: 'POST',
    headers: (params: ApolloContactCreateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloContactCreateParams) => {
      const body: any = {
        first_name: params.first_name,
        last_name: params.last_name,
      }
      if (params.email) body.email = params.email
      if (params.title) body.title = params.title
      if (params.account_id) body.account_id = params.account_id
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
        contact: data.contact ?? null,
        created: !!data.contact,
      },
    }
  },

  outputs: {
    contact: { type: 'json', description: 'Created contact data from Apollo', optional: true },
    created: { type: 'boolean', description: 'Whether the contact was successfully created' },
  },
}
