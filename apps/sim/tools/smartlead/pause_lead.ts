import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadActionResponse, SmartleadCampaignLeadParams } from '@/tools/smartlead/types'
import {
  actionOutputs,
  isOk,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadLeadIdParamField,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const pauseLeadTool: ToolConfig<SmartleadCampaignLeadParams, SmartleadActionResponse> = {
  id: 'smartlead_pause_lead',
  name: 'Smartlead Pause Lead',
  description: 'Pauses a lead in a Smartlead campaign so it stops receiving sequence emails.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    ...smartleadLeadIdParamField,
  },
  request: {
    url: (params) =>
      smartleadUrl(
        `/campaigns/${pathSegment(params.campaignId)}/leads/${pathSegment(params.leadId)}/pause`,
        params.apiKey
      ),
    method: 'POST',
    headers: smartleadHeaders,
    body: () => ({}),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead pause')

    return {
      success: true,
      output: { success: isOk(record) },
    }
  },
  outputs: actionOutputs,
}
