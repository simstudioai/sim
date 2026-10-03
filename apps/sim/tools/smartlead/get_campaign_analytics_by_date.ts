import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignAnalyticsByDateResponse,
  SmartleadCampaignIdParams,
} from '@/tools/smartlead/types'
import {
  campaignAnalyticsByDateOutputs,
  mapCampaignAnalyticsByDate,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface GetCampaignAnalyticsByDateParams extends SmartleadCampaignIdParams {
  startDate: string
  endDate: string
}

export const getCampaignAnalyticsByDateTool: ToolConfig<
  GetCampaignAnalyticsByDateParams,
  SmartleadCampaignAnalyticsByDateResponse
> = {
  id: 'smartlead_get_campaign_analytics_by_date',
  name: 'Smartlead Get Campaign Analytics By Date',
  description:
    'Retrieves Smartlead campaign performance totals for a date range. Smartlead rejects ranges longer than roughly one month.',
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
        `/campaigns/${pathSegment(params.campaignId)}/analytics-by-date`,
        params.apiKey,
        {
          start_date: params.startDate,
          end_date: params.endDate,
        }
      ),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'campaign analytics')

    return {
      success: true,
      output: mapCampaignAnalyticsByDate(record),
    }
  },
  outputs: campaignAnalyticsByDateOutputs,
}
