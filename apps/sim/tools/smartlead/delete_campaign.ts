import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadActionResponse, SmartleadCampaignIdParams } from '@/tools/smartlead/types'
import {
  actionOutputs,
  isOk,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteCampaignTool: ToolConfig<SmartleadCampaignIdParams, SmartleadActionResponse> = {
  id: 'smartlead_delete_campaign',
  name: 'Smartlead Delete Campaign',
  description:
    'Permanently deletes a Smartlead campaign along with its sequences, leads, and webhooks. This cannot be undone.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
  },
  request: {
    url: (params) => smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}`, params.apiKey),
    method: 'DELETE',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'campaign delete')

    return {
      success: true,
      output: { success: isOk(record) },
    }
  },
  outputs: actionOutputs,
}
