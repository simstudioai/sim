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
      visibility: 'user-or-llm',
      description: 'ID of the sequence to add contacts to (e.g., "seq_abc123")',
    },
    contact_ids: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of contact IDs to add to the sequence (e.g., ["con_abc123", "con_def456"]). Either contact_ids or label_names must be provided.',
    },
    label_names: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of label names to identify contacts to add to the sequence. Either contact_ids or label_names must be provided.',
    },
    send_email_from_email_account_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ID of the email account to send from. Use the Get Email Accounts operation to look this up.',
    },
    send_email_from_email_address: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Specific email address to send from within the email account.',
    },
    sequence_no_email: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Add contacts even if they have no email address',
    },
    sequence_unverified_email: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Add contacts with unverified email addresses',
    },
    sequence_job_change: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Add contacts who recently changed jobs',
    },
    sequence_active_in_other_campaigns: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Add contacts active in other campaigns',
    },
    sequence_finished_in_other_campaigns: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Add contacts who finished other campaigns',
    },
  },

  request: {
    url: (params: ApolloSequenceAddContactsParams) =>
      `https://api.apollo.io/api/v1/emailer_campaigns/${params.sequence_id.trim()}/add_contact_ids`,
    method: 'POST',
    headers: (params: ApolloSequenceAddContactsParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloSequenceAddContactsParams) => {
      const hasContactIds = !!params.contact_ids?.length
      const hasLabelNames = !!params.label_names?.length
      if (!hasContactIds && !hasLabelNames) {
        throw new Error(
          'Apollo sequence add requires either contact_ids or label_names to be provided'
        )
      }
      const body: Record<string, unknown> = {
        emailer_campaign_id: params.sequence_id,
        send_email_from_email_account_id: params.send_email_from_email_account_id,
      }
      if (hasContactIds) body.contact_ids = params.contact_ids
      if (hasLabelNames) body.label_names = params.label_names
      if (params.send_email_from_email_address) {
        body.send_email_from_email_address = params.send_email_from_email_address
      }
      if (params.sequence_no_email !== undefined) body.sequence_no_email = params.sequence_no_email
      if (params.sequence_unverified_email !== undefined) {
        body.sequence_unverified_email = params.sequence_unverified_email
      }
      if (params.sequence_job_change !== undefined) {
        body.sequence_job_change = params.sequence_job_change
      }
      if (params.sequence_active_in_other_campaigns !== undefined) {
        body.sequence_active_in_other_campaigns = params.sequence_active_in_other_campaigns
      }
      if (params.sequence_finished_in_other_campaigns !== undefined) {
        body.sequence_finished_in_other_campaigns = params.sequence_finished_in_other_campaigns
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

    const added = Array.isArray(data?.contacts?.added) ? data.contacts.added : []
    const skipped = Array.isArray(data?.contacts?.skipped) ? data.contacts.skipped : []
    const rawSkippedIds = data?.skipped_contact_ids
    const skippedIds =
      Array.isArray(rawSkippedIds) || (rawSkippedIds && typeof rawSkippedIds === 'object')
        ? rawSkippedIds
        : null

    return {
      success: true,
      output: {
        added,
        skipped,
        skipped_contact_ids: skippedIds,
        emailer_campaign: data?.emailer_campaign ?? null,
        sequence_id: params?.sequence_id || data?.emailer_campaign?.id || '',
        total_added: added.length,
        total_skipped: skipped.length,
      },
    }
  },

  outputs: {
    added: {
      type: 'json',
      description: 'Array of contact objects successfully added to the sequence',
    },
    skipped: {
      type: 'json',
      description: 'Array of contact objects that were skipped, with reasons',
    },
    skipped_contact_ids: {
      type: 'json',
      description:
        'Skipped contact IDs — either an array of IDs or a hash mapping ID → reason code',
      optional: true,
    },
    emailer_campaign: {
      type: 'json',
      description: 'Details of the emailer campaign (id, name)',
      optional: true,
    },
    sequence_id: { type: 'string', description: 'ID of the sequence contacts were added to' },
    total_added: { type: 'number', description: 'Total number of contacts added' },
    total_skipped: { type: 'number', description: 'Total number of contacts skipped' },
  },
}
