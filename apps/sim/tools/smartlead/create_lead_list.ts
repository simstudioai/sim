import { isRecordLike } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadBaseParams, SmartleadLeadListResponse } from '@/tools/smartlead/types'
import {
  leadListOutputs,
  mapLeadList,
  smartleadBaseParamFields,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface CreateLeadListParams extends SmartleadBaseParams {
  listName: string
}

export const createLeadListTool: ToolConfig<CreateLeadListParams, SmartleadLeadListResponse> = {
  id: 'smartlead_create_lead_list',
  name: 'Smartlead Create Lead List',
  description: 'Creates a lead list on the Smartlead account.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    listName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the new lead list',
    },
  },
  request: {
    url: (params) => smartleadUrl('/lead-list/', params.apiKey),
    method: 'POST',
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
