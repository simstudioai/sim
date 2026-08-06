import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadExportLeadsResponse,
} from '@/tools/smartlead/types'
import {
  exportLeadsOutputs,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const exportCampaignLeadsTool: ToolConfig<
  SmartleadCampaignIdParams,
  SmartleadExportLeadsResponse
> = {
  id: 'smartlead_export_campaign_leads',
  name: 'Smartlead Export Campaign Leads',
  description:
    'Exports every lead in a Smartlead campaign as CSV, including engagement counts and the sequence step last sent to each lead.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/leads-export`, params.apiKey),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },
  transformResponse: async (response) => {
    const csv = await response.text()
    // The first line is the header row, so data rows are the remaining non-empty lines.
    const rowCount = csv.split('\n').filter((line) => line.trim() !== '').length

    return {
      success: true,
      output: {
        csv,
        row_count: Math.max(0, rowCount - 1),
      },
    }
  },
  outputs: exportLeadsOutputs,
}
