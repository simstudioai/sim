import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignLeadParams,
  SmartleadMessageHistoryResponse,
} from '@/tools/smartlead/types'
import {
  messageHistoryOutputs,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadLeadIdParamField,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const getLeadMessageHistoryTool: ToolConfig<
  SmartleadCampaignLeadParams,
  SmartleadMessageHistoryResponse
> = {
  id: 'smartlead_get_lead_message_history',
  name: 'Smartlead Get Lead Message History',
  description:
    'Retrieves the sent-and-received message history for a lead in a Smartlead campaign.',
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
        `/campaigns/${pathSegment(params.campaignId)}/leads/${pathSegment(params.leadId)}/message-history`,
        params.apiKey
      ),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'message history')
    const history = Array.isArray(record.history) ? record.history : []

    return {
      success: true,
      output: {
        history,
        count: history.length,
      },
    }
  },
  outputs: messageHistoryOutputs,
}
