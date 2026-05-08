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
    contact_ids: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of contact IDs to update. Must be paired with an object-form contact_attributes specifying the fields to apply uniformly to all listed contacts.',
    },
    contact_attributes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Required. Either an array of per-contact updates (each with id) — used standalone — or a single object of attributes to apply to all contact_ids. Supported fields: owner_id, email, organization_name, title, first_name, last_name, account_id, present_raw_address, linkedin_url, typed_custom_fields',
    },
    async: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Force asynchronous processing. Automatically enabled for >100 contacts',
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
    body: (params: ApolloContactBulkUpdateParams) => {
      const body: Record<string, unknown> = {}
      if (params.contact_ids && params.contact_ids.length > 0) {
        body.contact_ids = params.contact_ids.slice(0, 100)
      }
      if (params.contact_attributes) {
        if (Array.isArray(params.contact_attributes)) {
          if (params.contact_attributes.length > 0) {
            body.contact_attributes = params.contact_attributes.slice(0, 100)
          }
        } else if (
          typeof params.contact_attributes === 'object' &&
          Object.keys(params.contact_attributes).length > 0
        ) {
          body.contact_attributes = params.contact_attributes
        }
      }
      if (!body.contact_attributes) {
        throw new Error(
          'Apollo bulk update requires contact_attributes (the fields to update). Use contact_attributes alone (array of per-contact updates with id) or together with contact_ids (single object applied to all listed contacts).'
        )
      }
      if (!Array.isArray(body.contact_attributes) && !body.contact_ids) {
        throw new Error(
          'Apollo bulk update with object-form contact_attributes requires contact_ids to identify which contacts to update.'
        )
      }
      if (body.contact_ids && Array.isArray(body.contact_attributes)) {
        throw new Error(
          'Apollo contact bulk update cannot combine contact_ids with array-form contact_attributes. Use contact_ids with object-form contact_attributes for uniform updates, or use array-form contact_attributes alone (each entry carries its own id).'
        )
      }
      if (params.async !== undefined) body.async = params.async
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
        message: data.message ?? null,
        job_id: data.job_id ?? null,
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Confirmation message from Apollo',
      optional: true,
    },
    job_id: {
      type: 'string',
      description: 'Async job ID (returned for >100 contacts)',
      optional: true,
    },
  },
}
