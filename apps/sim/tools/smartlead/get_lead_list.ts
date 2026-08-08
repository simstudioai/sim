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

interface GetLeadListParams extends SmartleadBaseParams {
  leadListId: number
}

export const getLeadListTool: ToolConfig<GetLeadListParams, SmartleadLeadListResponse> = {
  id: 'smartlead_get_lead_list',
  name: 'Smartlead Get Lead List',
  description: 'Retrieves a single Smartlead lead list by ID.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    leadListId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead list ID',
    },
  },
  request: {
    url: (params) => smartleadUrl(`/lead-list/${pathSegment(params.leadListId)}`, params.apiKey),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead list')
    const data = isRecordLike(record.data) ? record.data : null
    if (!data) throw new Error('Smartlead lead list not found')

    return {
      success: true,
      output: mapLeadList(data),
    }
  },
  outputs: leadListOutputs,
}
