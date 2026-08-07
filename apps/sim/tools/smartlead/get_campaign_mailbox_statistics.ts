import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadOpaqueListResponse,
} from '@/tools/smartlead/types'
import {
  opaqueListOutputs,
  opaqueRows,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const getCampaignMailboxStatisticsTool: ToolConfig<
  SmartleadCampaignIdParams,
  SmartleadOpaqueListResponse
> = {
  id: 'smartlead_get_campaign_mailbox_statistics',
  name: 'Smartlead Get Campaign Mailbox Statistics',
  description:
    'Retrieves per-mailbox sending statistics for a Smartlead campaign, for spotting which sending accounts are underperforming.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
  },
  request: {
    url: (params) =>
      smartleadUrl(
        `/campaigns/${pathSegment(params.campaignId)}/mailbox-statistics`,
        params.apiKey
      ),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'mailbox statistics')
    const items = opaqueRows(record.data)

    return {
      success: true,
      output: { items, count: items.length },
    }
  },
  outputs: opaqueListOutputs,
}
