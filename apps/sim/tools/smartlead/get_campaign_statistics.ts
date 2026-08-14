import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadCampaignStatisticsResponse,
} from '@/tools/smartlead/types'
import {
  campaignStatisticsOutputs,
  pathSegment,
  type SMARTLEAD_EMAIL_STATUSES,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface GetCampaignStatisticsParams extends SmartleadCampaignIdParams {
  offset?: number
  limit?: number
  emailSequenceNumber?: number
  emailStatus?: (typeof SMARTLEAD_EMAIL_STATUSES)[number]
  sentTimeStartDate?: string
  sentTimeEndDate?: string
}

export const getCampaignStatisticsTool: ToolConfig<
  GetCampaignStatisticsParams,
  SmartleadCampaignStatisticsResponse
> = {
  id: 'smartlead_get_campaign_statistics',
  name: 'Smartlead Get Campaign Statistics',
  description:
    'Retrieves per-email statistics rows for a Smartlead campaign, filterable by sequence step, engagement status, and sent-time range.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset (default 0)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rows to return (default 100)',
    },
    emailSequenceNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return rows for this sequence step',
    },
    emailStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return rows with this engagement status: opened, clicked, replied, unsubscribed, bounced',
    },
    sentTimeStartDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return rows sent on or after this date (YYYY-MM-DD)',
    },
    sentTimeEndDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return rows sent on or before this date (YYYY-MM-DD)',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/statistics`, params.apiKey, {
        offset: params.offset,
        limit: params.limit,
        email_sequence_number: params.emailSequenceNumber,
        email_status: params.emailStatus,
        sent_time_start_date: params.sentTimeStartDate,
        sent_time_end_date: params.sentTimeEndDate,
      }),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'campaign statistics')
    const stats = Array.isArray(record.data) ? record.data : []

    return {
      success: true,
      output: {
        stats,
        total_stats: Number(record.total_stats ?? stats.length) || 0,
        offset: typeof record.offset === 'number' ? record.offset : null,
        limit: typeof record.limit === 'number' ? record.limit : null,
      },
    }
  },
  outputs: campaignStatisticsOutputs,
}
