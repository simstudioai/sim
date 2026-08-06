import { isRecordLike } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadBaseParams, SmartleadLeadListsResponse } from '@/tools/smartlead/types'
import {
  leadListsOutputs,
  mapLeadList,
  smartleadBaseParamFields,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface ListLeadListsParams extends SmartleadBaseParams {
  offset?: number
  limit?: number
}

export const listLeadListsTool: ToolConfig<ListLeadListsParams, SmartleadLeadListsResponse> = {
  id: 'smartlead_list_lead_lists',
  name: 'Smartlead List Lead Lists',
  description: 'Retrieves the lead lists on the Smartlead account with their lead counts.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset (default 0)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lists to return per page',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl('/lead-list/', params.apiKey, {
        offset: params.offset,
        limit: params.limit,
      }),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead lists')
    const data = isRecordLike(record.data) ? record.data : {}
    const rows = Array.isArray(data.lists) ? data.lists : []
    const lists = rows.map(mapLeadList)

    return {
      success: true,
      output: {
        lists,
        total_count: typeof data.totalCount === 'number' ? data.totalCount : null,
        count: lists.length,
      },
    }
  },
  outputs: leadListsOutputs,
}
