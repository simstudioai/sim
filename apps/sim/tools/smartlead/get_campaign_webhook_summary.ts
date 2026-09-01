import { isRecordLike } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadWebhookSummaryResponse,
} from '@/tools/smartlead/types'
import {
  opaqueRows,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
  webhookSummaryOutputs,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface GetWebhookSummaryParams extends SmartleadCampaignIdParams {
  fromTime: string
  toTime: string
}

export const getCampaignWebhookSummaryTool: ToolConfig<
  GetWebhookSummaryParams,
  SmartleadWebhookSummaryResponse
> = {
  id: 'smartlead_get_campaign_webhook_summary',
  name: 'Smartlead Get Campaign Webhook Summary',
  description:
    'Retrieves webhook delivery counts for a Smartlead campaign over a time window, for checking whether events are reaching their destination.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    fromTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start of the window as an ISO 8601 timestamp',
    },
    toTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End of the window as an ISO 8601 timestamp',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/webhooks/summary`, params.apiKey, {
        fromTime: params.fromTime,
        toTime: params.toTime,
      }),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'webhook summary')
    const data = isRecordLike(record.data) ? record.data : {}
    const summary = opaqueRows(data.summary)
    const timeRange = isRecordLike(data.timeRange) ? data.timeRange : {}

    return {
      success: true,
      output: {
        summary,
        count: summary.length,
        from: typeof timeRange.from === 'string' ? timeRange.from : null,
        to: typeof timeRange.to === 'string' ? timeRange.to : null,
      },
    }
  },
  outputs: webhookSummaryOutputs,
}
