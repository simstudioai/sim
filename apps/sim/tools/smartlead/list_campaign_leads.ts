import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadListCampaignLeadsResponse,
} from '@/tools/smartlead/types'
import {
  listCampaignLeadsOutputs,
  mapCampaignLead,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface ListCampaignLeadsParams extends SmartleadCampaignIdParams {
  offset?: number
  limit?: number
}

export const listCampaignLeadsTool: ToolConfig<
  ListCampaignLeadsParams,
  SmartleadListCampaignLeadsResponse
> = {
  id: 'smartlead_list_campaign_leads',
  name: 'Smartlead List Campaign Leads',
  description: 'Retrieves the leads in a Smartlead campaign with their per-campaign status.',
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
      description: 'Leads to return per page (default 100)',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/leads`, params.apiKey, {
        offset: params.offset,
        limit: params.limit,
      }),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'campaign leads')
    const data = Array.isArray(record.data) ? record.data : []
    const leads = data.map(mapCampaignLead)

    return {
      success: true,
      output: {
        leads,
        total_leads: Number(record.total_leads ?? leads.length) || 0,
        offset: typeof record.offset === 'number' ? record.offset : null,
        limit: typeof record.limit === 'number' ? record.limit : null,
        count: leads.length,
      },
    }
  },
  outputs: listCampaignLeadsOutputs,
}
