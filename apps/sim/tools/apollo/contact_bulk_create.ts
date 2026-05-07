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
        'Array of contacts to create (max 100). Each contact may include first_name, last_name, email, title, organization_name, account_id, owner_id, contact_stage_id, linkedin_url, phone (single string) or phone_numbers (array of {raw_number, position}), contact_emails, typed_custom_fields, and CRM IDs (salesforce_contact_id, hubspot_id, team_id) for cross-system matching',
    },
    append_label_names: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Label names to add to all contacts in this request (e.g., ["Hot Lead"])',
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
      const body: Record<string, unknown> = {
        contacts: params.contacts.slice(0, 100),
      }
      if (params.run_dedupe !== undefined) {
        body.run_dedupe = params.run_dedupe
      }
      if (params.append_label_names && params.append_label_names.length > 0) {
        body.append_label_names = params.append_label_names
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
    const createdContacts = data.created_contacts || data.contacts || []
    const existingContacts = data.existing_contacts || []

    return {
      success: true,
      output: {
        created_contacts: createdContacts,
        existing_contacts: existingContacts,
        total_submitted: createdContacts.length + existingContacts.length,
        created: createdContacts.length,
        existing: existingContacts.length,
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
