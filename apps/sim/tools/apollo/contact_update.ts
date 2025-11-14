import type { ToolConfig } from '@/tools/types'
import type { ApolloContactUpdateParams, ApolloContactUpdateResponse } from './types'

export const apolloContactUpdateTool: ToolConfig<
  ApolloContactUpdateParams,
  ApolloContactUpdateResponse
> = {
  id: 'apollo_contact_update',
  name: 'Apollo Update Contact',
  description: 'Update an existing contact in your Apollo database',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key',
    },
    contact_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the contact to update',
    },
    first_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the contact',
    },
    last_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the contact',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job title',
    },
    account_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Apollo account ID',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User ID of the contact owner',
    },
  },

  request: {
    url: (params: ApolloContactUpdateParams) =>
      `https://api.apollo.io/api/v1/contacts/${params.contact_id}`,
    method: 'PATCH',
    headers: (params: ApolloContactUpdateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloContactUpdateParams) => {
      const body: any = {}
      if (params.first_name) body.first_name = params.first_name
      if (params.last_name) body.last_name = params.last_name
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
        contact: data.contact || {},
        metadata: {
          updated: !!data.contact,
        },
      },
    }
  },

  outputs: {
    contact: { type: 'json', description: 'Updated contact data from Apollo' },
    metadata: { type: 'json', description: 'Update metadata including updated status' },
  },
}
