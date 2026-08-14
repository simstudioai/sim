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

export const unsubscribeLeadFromCampaignTool: ToolConfig<
  SmartleadCampaignLeadParams,
  SmartleadActionResponse
> = {
  id: 'smartlead_unsubscribe_lead_from_campaign',
  name: 'Smartlead Unsubscribe Lead from Campaign',
  description:
    'Unsubscribes a lead from a single Smartlead campaign, leaving it active in other campaigns.',
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
        `/campaigns/${pathSegment(params.campaignId)}/leads/${pathSegment(params.leadId)}/unsubscribe`,
        params.apiKey
      ),
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
