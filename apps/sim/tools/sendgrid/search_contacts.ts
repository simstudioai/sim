import type { ContactsResult, SearchContactsParams, SendGridContact } from '@/tools/sendgrid/types'
import type { ToolConfig } from '@/tools/types'

export const sendGridSearchContactsTool: ToolConfig<SearchContactsParams, ContactsResult> = {
  id: 'sendgrid_search_contacts',
  name: 'SendGrid Search Contacts',
  description: 'Search for contacts in SendGrid using a query',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Search query (e.g., \"email LIKE '%example.com%' AND CONTAINS(list_ids, 'list-id')\")",
    },
  },

  request: {
    url: () => 'https://api.sendgrid.com/v3/marketing/contacts/search',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return {
        body: JSON.stringify({
          query: params.query,
        }),
      }
    },
  },

  transformResponse: async (response): Promise<ContactsResult> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to search contacts')
    }

    const data = (await response.json()) as {
      result?: SendGridContact[]
      contact_count?: number
    }

    return {
      success: true,
      output: {
        contacts: data.result || [],
        contactCount: data.contact_count,
      },
    }
  },

  outputs: {
    contacts: { type: 'json', description: 'Array of matching contacts' },
    contactCount: { type: 'number', description: 'Total number of contacts found' },
  },
}
