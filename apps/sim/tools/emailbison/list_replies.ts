import type {
  EmailBisonListRepliesParams,
  EmailBisonListRepliesResponse,
} from '@/tools/emailbison/types'
import {
  emailBisonData,
  emailBisonHeaders,
  emailBisonUrl,
  listRepliesOutputs,
  mapReply,
} from '@/tools/emailbison/utils'
import type { ToolConfig } from '@/tools/types'

export const listRepliesTool: ToolConfig<
  EmailBisonListRepliesParams,
  EmailBisonListRepliesResponse
> = {
  id: 'emailbison_list_replies',
  name: 'Email Bison List Replies',
  description:
    'Retrieves Email Bison replies with optional status, folder, campaign, sender, lead, and tag filters.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Email Bison API token',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term for replies',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reply status: interested, automated_reply, or not_automated_reply',
    },
    folder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reply folder: inbox, sent, spam, bounced, or all',
    },
    read: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by read state',
    },
    campaignId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Campaign ID',
    },
    senderEmailId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sender email ID',
    },
    leadId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead ID',
    },
    tagIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tag IDs to filter replies by',
      items: { type: 'number', description: 'Tag ID' },
    },
  },
  request: {
    url: (params) =>
      emailBisonUrl('/api/replies', {
        search: params.search,
        status: params.status,
        folder: params.folder,
        read: params.read,
        campaign_id: params.campaignId,
        sender_email_id: params.senderEmailId,
        lead_id: params.leadId,
        tag_ids: params.tagIds,
      }),
    method: 'GET',
    headers: emailBisonHeaders,
  },
  transformResponse: async (response) => {
    const data = (await emailBisonData<unknown[]>(response)) ?? []
    const replies = Array.isArray(data) ? data.map(mapReply) : []

    return {
      success: true,
      output: {
        replies,
        count: replies.length,
      },
    }
  },
  outputs: listRepliesOutputs,
}
