import type {
  InstantlyDeleteLeadsParams,
  InstantlyDeleteLeadsResponse,
} from '@/tools/instantly/types'
import {
  asRecord,
  compactBody,
  instantlyBaseParamFields,
  instantlyHeaders,
  instantlyUrl,
  parseInstantlyResponse,
} from '@/tools/instantly/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteLeadsTool: ToolConfig<InstantlyDeleteLeadsParams, InstantlyDeleteLeadsResponse> =
  {
    id: 'instantly_delete_leads',
    name: 'Instantly Delete Leads',
    description: 'Deletes Instantly V2 leads in bulk from a campaign or lead list.',
    version: '1.0.0',
    params: {
      ...instantlyBaseParamFields,
      campaign_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Campaign ID to delete leads from. Required if list_id is not provided.',
      },
      list_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Lead list ID to delete leads from. Required if campaign_id is not provided.',
      },
      status: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional lead status filter',
      },
      ids: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'Specific lead IDs to delete',
        items: { type: 'string', description: 'Lead ID' },
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of matching leads to delete, up to 10000',
      },
    },
    request: {
      url: () => instantlyUrl('/api/v2/leads'),
      method: 'DELETE',
      headers: instantlyHeaders,
      body: (params) =>
        compactBody({
          campaign_id: params.campaign_id,
          list_id: params.list_id,
          status: params.status,
          ids: params.ids,
          limit: params.limit,
        }),
    },
    transformResponse: async (response) => {
      const data = await parseInstantlyResponse(response)
      const result = asRecord(data)

      return {
        success: true,
        output: {
          count: typeof result.count === 'number' ? result.count : null,
        },
      }
    },
    outputs: {
      count: { type: 'number', description: 'Number of leads deleted', optional: true },
    },
  }
