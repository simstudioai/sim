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

interface UnsubscribeLeadGloballyParams extends SmartleadBaseParams {
  leadId: number
}

export const unsubscribeLeadGloballyTool: ToolConfig<
  UnsubscribeLeadGloballyParams,
  SmartleadActionResponse
> = {
  id: 'smartlead_unsubscribe_lead_globally',
  name: 'Smartlead Unsubscribe Lead Globally',
  description:
    'Unsubscribes a lead across every Smartlead campaign and adds it to the account-wide unsubscribe list.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    leadId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Smartlead lead ID — the nested lead.id from List Campaign Leads, NOT campaign_lead_map_id',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(`/leads/${pathSegment(params.leadId)}/unsubscribe`, params.apiKey),
    method: 'POST',
    headers: smartleadHeaders,
    body: () => ({}),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead unsubscribe')

    return {
      success: true,
      output: { success: isOk(record) },
    }
  },
  outputs: actionOutputs,
}
