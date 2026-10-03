import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadDuplicateCampaignResponse,
} from '@/tools/smartlead/types'
import {
  duplicateCampaignOutputs,
  isOk,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const duplicateCampaignTool: ToolConfig<
  SmartleadCampaignIdParams,
  SmartleadDuplicateCampaignResponse
> = {
  id: 'smartlead_duplicate_campaign',
  name: 'Smartlead Duplicate Campaign',
  description:
    'Copies a Smartlead campaign, including its sequences and settings. The copy is named "<original> - copy" and starts in DRAFTED status.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/duplicate`, params.apiKey),
    method: 'POST',
    headers: smartleadHeaders,
    body: () => ({}),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'campaign duplicate')
    const id = record.newCampaignId

    return {
      success: true,
      output: {
        success: isOk(record),
        id: typeof id === 'number' ? id : null,
      },
    }
  },
  outputs: duplicateCampaignOutputs,
}
