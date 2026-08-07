import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadActionResponse, SmartleadBaseParams } from '@/tools/smartlead/types'
import {
  actionOutputs,
  isOk,
  pathSegment,
  smartleadBaseParamFields,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface DeleteLeadListParams extends SmartleadBaseParams {
  leadListId: number
}

export const deleteLeadListTool: ToolConfig<DeleteLeadListParams, SmartleadActionResponse> = {
  id: 'smartlead_delete_lead_list',
  name: 'Smartlead Delete Lead List',
  description: 'Deletes a Smartlead lead list.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    leadListId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead list ID to delete',
    },
  },
  request: {
    url: (params) => smartleadUrl(`/lead-list/${pathSegment(params.leadListId)}`, params.apiKey),
    method: 'DELETE',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead list delete')

    return {
      success: true,
      output: { success: isOk(record) },
    }
  },
  outputs: actionOutputs,
}
