import { isRecordLike } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadBaseParams, SmartleadLeadListResponse } from '@/tools/smartlead/types'
import {
  leadListOutputs,
  mapLeadList,
  pathSegment,
  smartleadBaseParamFields,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface UpdateLeadListParams extends SmartleadBaseParams {
  leadListId: number
  listName: string
}

export const updateLeadListTool: ToolConfig<UpdateLeadListParams, SmartleadLeadListResponse> = {
  id: 'smartlead_update_lead_list',
  name: 'Smartlead Update Lead List',
  description: 'Renames a Smartlead lead list.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    leadListId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead list ID to update',
    },
    listName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New name for the lead list',
    },
  },
  request: {
    url: (params) => smartleadUrl(`/lead-list/${pathSegment(params.leadListId)}`, params.apiKey),
    method: 'PUT',
    headers: smartleadHeaders,
    body: (params) => ({ listName: params.listName }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead list')
    const data = isRecordLike(record.data) ? record.data : {}

    return {
      success: true,
      output: mapLeadList(data),
    }
  },
  outputs: leadListOutputs,
}
