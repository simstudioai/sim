import { ErrorExtractorId } from '@/tools/error-extractors'
import { SMARTLEAD_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { SmartleadCampaignIdParams, SmartleadCampaignResponse } from '@/tools/smartlead/types'
import {
  campaignOutputs,
  mapCampaign,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadExistingRecord,
  smartleadHeaders,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const getCampaignTool: ToolConfig<SmartleadCampaignIdParams, SmartleadCampaignResponse> = {
  id: 'smartlead_get_campaign',
  name: 'Smartlead Get Campaign',
  description: 'Retrieves a single Smartlead campaign by ID.',
  version: '1.0.0',
  oauth: SMARTLEAD_CREDENTIAL_OAUTH,
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
  },
  request: {
    url: (params) => smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}`, params.apiKey),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadExistingRecord(response, 'campaign')

    return {
      success: true,
      output: mapCampaign(record),
    }
  },
  outputs: campaignOutputs,
}
