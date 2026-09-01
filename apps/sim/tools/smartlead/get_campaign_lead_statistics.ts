import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadPaginatedRowsResponse,
} from '@/tools/smartlead/types'
import {
  opaqueRows,
  paginatedRowsOutputs,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface GetCampaignLeadStatisticsParams extends SmartleadCampaignIdParams {
  limit?: number
  offset?: number
}

export const getCampaignLeadStatisticsTool: ToolConfig<
  GetCampaignLeadStatisticsParams,
  SmartleadPaginatedRowsResponse
> = {
  id: 'smartlead_get_campaign_lead_statistics',
  name: 'Smartlead Get Campaign Lead Statistics',
  description: 'Retrieves per-lead engagement statistics for a Smartlead campaign.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rows to return (default 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rows to skip (default 0)',
    },
  },
  request: {
    // Smartlead takes `offset` here but echoes it back as `skip`.
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/leads-statistics`, params.apiKey, {
        limit: params.limit,
        offset: params.offset,
      }),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead statistics')
    const rows = opaqueRows(record.data)

    return {
      success: true,
      output: {
        rows,
        count: rows.length,
        has_more: typeof record.hasMore === 'boolean' ? record.hasMore : null,
        offset: typeof record.skip === 'number' ? record.skip : null,
        limit: typeof record.limit === 'number' ? record.limit : null,
      },
    }
  },
  outputs: paginatedRowsOutputs,
}
