import type {
  EmailBisonListLeadsParams,
  EmailBisonListLeadsResponse,
} from '@/tools/emailbison/types'
import {
  emailBisonArrayData,
  emailBisonBaseParamFields,
  emailBisonHeaders,
  emailBisonUrl,
  listLeadsOutputs,
  mapLead,
} from '@/tools/emailbison/utils'
import type { ToolConfig } from '@/tools/types'

export const listLeadsTool: ToolConfig<EmailBisonListLeadsParams, EmailBisonListLeadsResponse> = {
  id: 'emailbison_list_leads',
  name: 'Email Bison List Leads',
  description: 'Retrieves leads from Email Bison with optional search and tag filters.',
  version: '1.0.0',
  params: {
    ...emailBisonBaseParamFields,
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term for filtering leads',
    },
    campaignStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Lead campaign status filter: in_sequence, sequence_finished, sequence_stopped, never_contacted, or replied',
    },
    tagIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tag IDs to include',
      items: { type: 'number', description: 'Tag ID' },
    },
    excludedTagIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tag IDs to exclude',
      items: { type: 'number', description: 'Tag ID' },
    },
    withoutTags: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return leads without tags',
    },
  },
  request: {
    url: (params) =>
      emailBisonUrl(
        '/api/leads',
        {
          search: params.search,
          'filters.lead_campaign_status': params.campaignStatus,
          'filters.tag_ids': params.tagIds,
          'filters.excluded_tag_ids': params.excludedTagIds,
          'filters.without_tags': params.withoutTags,
        },
        params.apiBaseUrl
      ),
    method: 'GET',
    headers: emailBisonHeaders,
  },
  transformResponse: async (response) => {
    const data = await emailBisonArrayData(response, 'leads')
    const leads = data.map(mapLead)

    return {
      success: true,
      output: {
        leads,
        count: leads.length,
      },
    }
  },
  outputs: listLeadsOutputs,
}
