import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadTopLevelAnalyticsResponse,
} from '@/tools/smartlead/types'
import {
  mapTopLevelAnalytics,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadExistingRecord,
  smartleadHeaders,
  smartleadUrl,
  topLevelAnalyticsOutputs,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface GetTopLevelAnalyticsParams extends SmartleadCampaignIdParams {
  startDate: string
  endDate: string
}

export const getCampaignTopLevelAnalyticsByDateTool: ToolConfig<
  GetTopLevelAnalyticsParams,
  SmartleadTopLevelAnalyticsResponse
> = {
  id: 'smartlead_get_campaign_top_level_analytics_by_date',
  name: 'Smartlead Get Campaign Top-Level Analytics By Date',
  description:
    'Retrieves top-level Smartlead campaign counts for a date range, including positive replies, skipped, failed, and stopped counts not present in the standard analytics.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Range start date in YYYY-MM-DD format',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Range end date in YYYY-MM-DD format',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(
        `/campaigns/${pathSegment(params.campaignId)}/top-level-analytics-by-date`,
        params.apiKey,
        { start_date: params.startDate, end_date: params.endDate }
      ),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadExistingRecord(response, 'campaign')

    return {
      success: true,
      output: mapTopLevelAnalytics(record),
    }
  },
  outputs: topLevelAnalyticsOutputs,
}
