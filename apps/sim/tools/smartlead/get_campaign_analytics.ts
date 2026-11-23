import { ErrorExtractorId } from '@/tools/error-extractors'
import { SMARTLEAD_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type {
  SmartleadCampaignAnalyticsResponse,
  SmartleadCampaignIdParams,
} from '@/tools/smartlead/types'
import {
  campaignAnalyticsOutputs,
  mapCampaignAnalytics,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadExistingRecord,
  smartleadHeaders,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const getCampaignAnalyticsTool: ToolConfig<
  SmartleadCampaignIdParams,
  SmartleadCampaignAnalyticsResponse
> = {
  id: 'smartlead_get_campaign_analytics',
  name: 'Smartlead Get Campaign Analytics',
  description:
    'Retrieves lifetime performance totals for a Smartlead campaign — sends, opens, clicks, replies, bounces, and lead counts by state.',
  version: '1.0.0',
  oauth: SMARTLEAD_CREDENTIAL_OAUTH,
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/analytics`, params.apiKey),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadExistingRecord(response, 'campaign')

    return {
      success: true,
      output: mapCampaignAnalytics(record),
    }
  },
  outputs: campaignAnalyticsOutputs,
}
