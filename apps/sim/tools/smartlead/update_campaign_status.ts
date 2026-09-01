import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadActionResponse, SmartleadCampaignIdParams } from '@/tools/smartlead/types'
import {
  actionOutputs,
  isOk,
  pathSegment,
  type SMARTLEAD_CAMPAIGN_STATUSES,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface UpdateCampaignStatusParams extends SmartleadCampaignIdParams {
  status: (typeof SMARTLEAD_CAMPAIGN_STATUSES)[number]
}

export const updateCampaignStatusTool: ToolConfig<
  UpdateCampaignStatusParams,
  SmartleadActionResponse
> = {
  id: 'smartlead_update_campaign_status',
  name: 'Smartlead Update Campaign Status',
  description:
    'Starts, pauses, or stops a Smartlead campaign. START requires the campaign to already have a schedule, sequences, and at least one email account.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target status: START, PAUSED, STOPPED',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/status`, params.apiKey),
    method: 'POST',
    headers: smartleadHeaders,
    body: (params) => ({ status: params.status }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'status update')

    return {
      success: true,
      output: { success: isOk(record) },
    }
  },
  outputs: actionOutputs,
}
