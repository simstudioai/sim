import type {
  InstantlyListCampaignsParams,
  InstantlyListCampaignsResponse,
} from '@/tools/instantly/types'
import {
  campaignsListOutputs,
  getItems,
  getNextStartingAfter,
  instantlyBaseParamFields,
  instantlyHeaders,
  instantlyUrl,
  mapCampaign,
  parseInstantlyResponse,
} from '@/tools/instantly/utils'
import type { ToolConfig } from '@/tools/types'

export const listCampaignsTool: ToolConfig<
  InstantlyListCampaignsParams,
  InstantlyListCampaignsResponse
> = {
  id: 'instantly_list_campaigns',
  name: 'Instantly List Campaigns',
  description: 'Retrieves Instantly V2 campaigns with search, status, tag, and pagination filters.',
  version: '1.0.0',
  params: {
    ...instantlyBaseParamFields,
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of campaigns to return, from 1 to 100',
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
      description: 'Search by campaign name',
    },
    tag_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated campaign tag IDs',
    },
    ai_sales_agent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'AI Sales Agent ID filter',
    },
    status: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Campaign status enum value',
    },
  },
  request: {
    url: (params) =>
      instantlyUrl('/api/v2/campaigns', {
        limit: params.limit,
        starting_after: params.starting_after,
        search: params.search,
        tag_ids: params.tag_ids,
        ai_sales_agent_id: params.ai_sales_agent_id,
        status: params.status,
      }),
    method: 'GET',
    headers: instantlyHeaders,
  },
  transformResponse: async (response) => {
    const data = await parseInstantlyResponse(response)
    const campaigns = getItems(data).map(mapCampaign)

    return {
      success: true,
      output: {
        campaigns,
        count: campaigns.length,
        next_starting_after: getNextStartingAfter(data),
      },
    }
  },
  outputs: campaignsListOutputs,
}
