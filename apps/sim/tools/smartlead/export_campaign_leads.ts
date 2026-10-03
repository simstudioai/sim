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

/**
 * Counts data rows excluding the header, treating newlines inside quoted fields
 * as part of the value — lead names, locations, and custom fields can contain them.
 */
function countCsvDataRows(csv: string): number {
  let rows = 0
  let inQuotes = false
  let lineHasContent = false

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    if (char === '"') {
      // A doubled quote inside a quoted field is an escaped literal quote.
      if (inQuotes && csv[i + 1] === '"') {
        i++
        continue
      }
      inQuotes = !inQuotes
      lineHasContent = true
      continue
    }
    if (char === '\n' && !inQuotes) {
      if (lineHasContent) rows++
      lineHasContent = false
      continue
    }
    if (char !== '\r') lineHasContent = true
  }
  if (lineHasContent) rows++

  return Math.max(0, rows - 1)
}

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

    return {
      success: true,
      output: {
        csv,
        row_count: countCsvDataRows(csv),
      },
    }
  },
  outputs: exportLeadsOutputs,
}
