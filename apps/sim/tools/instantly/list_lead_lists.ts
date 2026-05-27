import type {
  InstantlyListLeadListsParams,
  InstantlyListLeadListsResponse,
} from '@/tools/instantly/types'
import {
  getItems,
  getNextStartingAfter,
  instantlyBaseParamFields,
  instantlyHeaders,
  instantlyUrl,
  leadListsListOutputs,
  mapLeadList,
  parseInstantlyResponse,
} from '@/tools/instantly/utils'
import type { ToolConfig } from '@/tools/types'

export const listLeadListsTool: ToolConfig<
  InstantlyListLeadListsParams,
  InstantlyListLeadListsResponse
> = {
  id: 'instantly_list_lead_lists',
  name: 'Instantly List Lead Lists',
  description: 'Retrieves Instantly V2 lead lists with search and pagination filters.',
  version: '1.0.0',
  params: {
    ...instantlyBaseParamFields,
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of lead lists to return, from 1 to 100',
    },
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Starting-after timestamp cursor',
    },
    has_enrichment_task: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by enrichment task setting',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query to filter lead lists by name',
    },
  },
  request: {
    url: (params) =>
      instantlyUrl('/api/v2/lead-lists', {
        limit: params.limit,
        starting_after: params.starting_after,
        has_enrichment_task: params.has_enrichment_task,
        search: params.search,
      }),
    method: 'GET',
    headers: instantlyHeaders,
  },
  transformResponse: async (response) => {
    const data = await parseInstantlyResponse(response)
    const leadLists = getItems(data).map(mapLeadList)

    return {
      success: true,
      output: {
        lead_lists: leadLists,
        count: leadLists.length,
        next_starting_after: getNextStartingAfter(data),
      },
    }
  },
  outputs: leadListsListOutputs,
}
