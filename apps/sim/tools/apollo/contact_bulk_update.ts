import type {
  ApolloContactBulkUpdateParams,
  ApolloContactBulkUpdateResponse,
} from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloContactBulkUpdateTool: ToolConfig<
  ApolloContactBulkUpdateParams,
  ApolloContactBulkUpdateResponse
> = {
  id: 'apollo_contact_bulk_update',
  name: 'Apollo Bulk Update Contacts',
  description:
    'Update up to 100 existing contacts at once in your Apollo database. Each contact must include an id field. Master key required.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key (master key required)',
    },
    contacts: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of contacts to update (max 100). Each contact must include id field, and optionally first_name, last_name, email, title, account_id, owner_id',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/contacts/bulk_update',
    method: 'POST',
    headers: (params: ApolloContactBulkUpdateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloContactBulkUpdateParams) => ({
      contacts: params.contacts.slice(0, 100),
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
        updated_contacts: data.contacts || data.updated_contacts || [],
        failed_contacts: data.failed_contacts || [],
        total_submitted: data.contacts?.length || 0,
        updated: data.updated_contacts?.length || data.contacts?.length || 0,
        failed: data.failed_contacts?.length || 0,
      },
    }
  },

  outputs: {
    updated_contacts: {
      type: 'json',
      description: 'Array of successfully updated contacts',
    },
    failed_contacts: {
      type: 'json',
      description: 'Array of contacts that failed to update',
    },
    total_submitted: {
      type: 'number',
      description: 'Total number of contacts submitted',
    },
    updated: {
      type: 'number',
      description: 'Number of contacts successfully updated',
    },
    failed: {
      type: 'number',
      description: 'Number of contacts that failed to update',
    },
  },
}
