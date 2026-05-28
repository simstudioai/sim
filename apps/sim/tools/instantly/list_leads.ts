import type { InstantlyListLeadsParams, InstantlyListLeadsResponse } from '@/tools/instantly/types'
import {
  compactBody,
  getItems,
  getNextStartingAfter,
  instantlyBaseParamFields,
  instantlyHeaders,
  instantlyUrl,
  leadsListOutputs,
  mapLead,
  parseInstantlyResponse,
} from '@/tools/instantly/utils'
import type { ToolConfig } from '@/tools/types'

export const listLeadsTool: ToolConfig<InstantlyListLeadsParams, InstantlyListLeadsResponse> = {
  id: 'instantly_list_leads',
  name: 'Instantly List Leads',
  description: 'Retrieves Instantly V2 leads with search, campaign, list, and pagination filters.',
  version: '1.0.0',
  params: {
    ...instantlyBaseParamFields,
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search by first name, last name, or email',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Instantly lead filter value, such as FILTER_VAL_CONTACTED or FILTER_VAL_ACTIVE',
    },
    campaign: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Campaign ID to filter leads',
    },
    list_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead list ID to filter leads',
    },
    in_campaign: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the lead is in a campaign',
    },
    in_list: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the lead is in a list',
    },
    ids: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead IDs to include',
      items: { type: 'string', description: 'Lead ID' },
    },
    excluded_ids: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead IDs to exclude',
      items: { type: 'string', description: 'Lead ID' },
    },
    organization_user_ids: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization user IDs to filter leads',
      items: { type: 'string', description: 'Organization user ID' },
    },
    smart_view_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Smart view ID to filter leads',
    },
    contacts: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead email addresses to include',
      items: { type: 'string', description: 'Email address' },
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of leads to return, from 1 to 100',
    },
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Forward pagination cursor from next_starting_after',
    },
    distinct_contacts: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to return distinct contacts',
    },
    is_website_visitor: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the lead is a website visitor',
    },
    enrichment_status: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enrichment status filter',
    },
    esg_code: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email security gateway code filter',
    },
  },
  request: {
    url: () => instantlyUrl('/api/v2/leads/list'),
    method: 'POST',
    headers: instantlyHeaders,
    body: (params) =>
      compactBody({
        search: params.search,
        filter: params.filter,
        campaign: params.campaign,
        list_id: params.list_id,
        in_campaign: params.in_campaign,
        in_list: params.in_list,
        ids: params.ids,
        excluded_ids: params.excluded_ids,
        contacts: params.contacts,
        limit: params.limit,
        starting_after: params.starting_after,
        organization_user_ids: params.organization_user_ids,
        smart_view_id: params.smart_view_id,
        is_website_visitor: params.is_website_visitor,
        distinct_contacts: params.distinct_contacts,
        enrichment_status: params.enrichment_status,
        esg_code: params.esg_code,
      }),
  },
  transformResponse: async (response) => {
    const data = await parseInstantlyResponse(response)
    const leads = getItems(data).map(mapLead)

    return {
      success: true,
      output: {
        leads,
        count: leads.length,
        next_starting_after: getNextStartingAfter(data),
      },
    }
  },
  outputs: leadsListOutputs,
}
