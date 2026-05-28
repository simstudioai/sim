import type {
  InstantlyListEmailsParams,
  InstantlyListEmailsResponse,
} from '@/tools/instantly/types'
import {
  emailsListOutputs,
  getItems,
  getNextStartingAfter,
  instantlyBaseParamFields,
  instantlyHeaders,
  instantlyUrl,
  mapEmail,
  parseInstantlyResponse,
} from '@/tools/instantly/utils'
import type { ToolConfig } from '@/tools/types'

export const listEmailsTool: ToolConfig<InstantlyListEmailsParams, InstantlyListEmailsResponse> = {
  id: 'instantly_list_emails',
  name: 'Instantly List Emails',
  description: 'Retrieves Instantly V2 Unibox emails with search and pagination filters.',
  version: '1.0.0',
  params: {
    ...instantlyBaseParamFields,
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of emails to return, from 1 to 100',
    },
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from next_starting_after',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query, email address, or thread:<thread-id>',
    },
    campaign_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Campaign ID filter',
    },
    list_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead list ID filter',
    },
    i_status: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email interest status filter',
    },
    eaccount: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sending email account filter',
    },
    lead: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead email address filter',
    },
    is_unread: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unread status filter',
    },
  },
  request: {
    url: (params) =>
      instantlyUrl('/api/v2/emails', {
        limit: params.limit,
        starting_after: params.starting_after,
        search: params.search,
        campaign_id: params.campaign_id,
        list_id: params.list_id,
        i_status: params.i_status,
        eaccount: params.eaccount,
        lead: params.lead,
        is_unread: params.is_unread,
      }),
    method: 'GET',
    headers: instantlyHeaders,
  },
  transformResponse: async (response) => {
    const data = await parseInstantlyResponse(response)
    const emails = getItems(data).map(mapEmail)

    return {
      success: true,
      output: {
        emails,
        count: emails.length,
        next_starting_after: getNextStartingAfter(data),
      },
    }
  },
  outputs: emailsListOutputs,
}
