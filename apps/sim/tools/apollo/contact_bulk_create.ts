import type {
  ApolloContactBulkCreateParams,
  ApolloContactBulkCreateResponse,
} from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloContactBulkCreateTool: ToolConfig<
  ApolloContactBulkCreateParams,
  ApolloContactBulkCreateResponse
> = {
  id: 'apollo_contact_bulk_create',
  name: 'Apollo Bulk Create Contacts',
  description:
    'Create up to 100 contacts at once in your Apollo database. Supports deduplication to prevent creating duplicate contacts. Master key required.',
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
        'Array of contacts to create (max 100). Each contact should include first_name, last_name, and optionally email, title, account_id, owner_id',
    },
    run_dedupe: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Enable deduplication to prevent creating duplicate contacts. When true, existing contacts are returned without modification',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/contacts/bulk_create',
    method: 'POST',
    headers: (params: ApolloContactBulkCreateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloContactBulkCreateParams) => {
      const body: any = {
        contacts: params.contacts.slice(0, 100),
      }
      if (params.run_dedupe !== undefined) {
        body.run_dedupe = params.run_dedupe
      }
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
        created_contacts: data.contacts || data.created_contacts || [],
        existing_contacts: data.existing_contacts || [],
        total_submitted: data.contacts?.length || 0,
        created: data.created_contacts?.length || data.contacts?.length || 0,
        existing: data.existing_contacts?.length || 0,
      },
    }
  },

  outputs: {
    created_contacts: {
      type: 'json',
      description: 'Array of newly created contacts',
    },
    existing_contacts: {
      type: 'json',
      description: 'Array of existing contacts (when deduplication is enabled)',
    },
    total_submitted: {
      type: 'number',
      description: 'Total number of contacts submitted',
    },
    created: {
      type: 'number',
      description: 'Number of contacts successfully created',
    },
    existing: {
      type: 'number',
      description: 'Number of existing contacts found',
    },
  },
}
