import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadActionResponse, SmartleadCampaignLeadParams } from '@/tools/smartlead/types'
import {
  actionOutputs,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadLeadIdParamField,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteLeadFromCampaignTool: ToolConfig<
  SmartleadCampaignLeadParams,
  SmartleadActionResponse
> = {
  id: 'smartlead_delete_lead_from_campaign',
  name: 'Smartlead Delete Lead from Campaign',
  description:
    'Removes a lead from a Smartlead campaign. The lead record itself remains on the account.',
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
        `/campaigns/${pathSegment(params.campaignId)}/leads/${pathSegment(params.leadId)}`,
        params.apiKey
      ),
    method: 'DELETE',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    // This endpoint answers with the bare string `success`, not JSON.
    const body = (await response.text()).trim()

    return {
      success: true,
      output: { success: body === 'success' || body === '"success"' },
    }
  },
  outputs: actionOutputs,
}
