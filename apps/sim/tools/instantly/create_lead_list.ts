import type {
  InstantlyCreateLeadListParams,
  InstantlyLeadListResponse,
} from '@/tools/instantly/types'
import {
  compactBody,
  instantlyBaseParamFields,
  instantlyHeaders,
  instantlyUrl,
  leadListOutputs,
  mapLeadList,
  parseInstantlyResponse,
} from '@/tools/instantly/utils'
import type { ToolConfig } from '@/tools/types'

export const createLeadListTool: ToolConfig<
  InstantlyCreateLeadListParams,
  InstantlyLeadListResponse
> = {
  id: 'instantly_create_lead_list',
  name: 'Instantly Create Lead List',
  description: 'Creates an Instantly V2 lead list.',
  version: '1.0.0',
  params: {
    ...instantlyBaseParamFields,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead list name',
    },
    has_enrichment_task: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether this list runs enrichment for every added lead',
    },
    owned_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID of the lead list owner',
    },
  },
  request: {
    url: () => instantlyUrl('/api/v2/lead-lists'),
    method: 'POST',
    headers: instantlyHeaders,
    body: (params) =>
      compactBody({
        name: params.name,
        has_enrichment_task: params.has_enrichment_task,
        owned_by: params.owned_by,
      }),
  },
  transformResponse: async (response) => {
    const data = await parseInstantlyResponse(response)
    const leadList = mapLeadList(data)

    return {
      success: true,
      output: {
        lead_list: leadList,
        id: leadList.id,
        name: leadList.name,
      },
    }
  },
  outputs: leadListOutputs,
}
