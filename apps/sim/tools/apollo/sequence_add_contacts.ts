import type {
  ApolloSequenceAddContactsParams,
  ApolloSequenceAddContactsResponse,
} from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloSequenceAddContactsTool: ToolConfig<
  ApolloSequenceAddContactsParams,
  ApolloSequenceAddContactsResponse
> = {
  id: 'apollo_sequence_add_contacts',
  name: 'Apollo Add Contacts to Sequence',
  description: 'Add contacts to an Apollo sequence',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key (master key required)',
    },
    sequence_id: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ID of the sequence to add contacts to',
    },
    contact_ids: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of contact IDs to add to the sequence',
    },
    emailer_campaign_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional emailer campaign ID',
    },
    send_email_from_user_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User ID to send emails from',
    },
  },

  request: {
    url: (params: ApolloSequenceAddContactsParams) =>
      `https://api.apollo.io/api/v1/emailer_campaigns/${params.sequence_id}/add_contact_ids`,
    method: 'POST',
    headers: (params: ApolloSequenceAddContactsParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloSequenceAddContactsParams) => {
      const body: any = {
        contact_ids: params.contact_ids,
      }
      if (params.emailer_campaign_id) {
        body.emailer_campaign_id = params.emailer_campaign_id
      }
      if (params.send_email_from_user_id) {
        body.send_email_from_user_id = params.send_email_from_user_id
      }
      return body
    },
  },

  transformResponse: async (response: Response, params?: ApolloSequenceAddContactsParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contacts_added: data.contacts || params?.contact_ids || [],
        metadata: {
          sequence_id: params?.sequence_id || '',
          total_added: data.contacts?.length || params?.contact_ids?.length || 0,
        },
      },
    }
  },

  outputs: {
    contacts_added: { type: 'json', description: 'Array of contact IDs added to the sequence' },
    metadata: {
      type: 'json',
      description: 'Sequence metadata including sequence_id and total_added count',
    },
  },
}
