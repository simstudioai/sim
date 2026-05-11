import type { ApolloContactUpdateParams, ApolloContactUpdateResponse } from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

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
      description: 'ID of the contact to update (e.g., "con_abc123")',
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
      description: 'Job title (e.g., "VP of Sales", "Software Engineer")',
    },
    account_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Apollo account ID (e.g., "acc_abc123")',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'User ID of the contact owner (accepted by Apollo but not officially documented for PATCH /contacts/{id})',
    },
    organization_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the contact\'s employer (e.g., "Apollo")',
    },
    website_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Corporate website URL (e.g., "https://www.apollo.io/")',
    },
    label_names: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lists/labels to add the contact to (e.g., ["Prospects"])',
    },
    contact_stage_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Apollo ID for the contact stage',
    },
    present_raw_address: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Personal location for the contact (e.g., "Atlanta, United States")',
    },
    direct_phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary phone number',
    },
    corporate_phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Work/office phone number',
    },
    mobile_phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mobile phone number',
    },
    home_phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Home phone number',
    },
    other_phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Alternative phone number',
    },
    typed_custom_fields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom field values keyed by custom field ID (accepted by Apollo but not officially documented for PATCH /contacts/{id})',
    },
  },

  request: {
    url: (params: ApolloContactUpdateParams) =>
      `https://api.apollo.io/api/v1/contacts/${params.contact_id.trim()}`,
    method: 'PATCH',
    headers: (params: ApolloContactUpdateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloContactUpdateParams) => {
      const body: Record<string, unknown> = {}
      if (params.first_name) body.first_name = params.first_name
      if (params.last_name) body.last_name = params.last_name
      if (params.email) body.email = params.email
      if (params.title) body.title = params.title
      if (params.account_id) body.account_id = params.account_id
      if (params.owner_id) body.owner_id = params.owner_id
      if (params.organization_name) body.organization_name = params.organization_name
      if (params.website_url) body.website_url = params.website_url
      if (params.label_names && params.label_names.length > 0) {
        body.label_names = params.label_names
      }
      if (params.contact_stage_id) body.contact_stage_id = params.contact_stage_id
      if (params.present_raw_address) body.present_raw_address = params.present_raw_address
      if (params.direct_phone) body.direct_phone = params.direct_phone
      if (params.corporate_phone) body.corporate_phone = params.corporate_phone
      if (params.mobile_phone) body.mobile_phone = params.mobile_phone
      if (params.home_phone) body.home_phone = params.home_phone
      if (params.other_phone) body.other_phone = params.other_phone
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
    const contact = data?.contact ?? (data?.id ? data : null)

    return {
      success: true,
      output: {
        contact,
        updated: !!contact,
      },
    }
  },

  outputs: {
    contact: { type: 'json', description: 'Updated contact data from Apollo', optional: true },
    updated: { type: 'boolean', description: 'Whether the contact was successfully updated' },
  },
}
