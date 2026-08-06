import { isRecordLike } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadMarkCompleteResponse,
} from '@/tools/smartlead/types'
import {
  isOk,
  markCompleteOutputs,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface MarkLeadCompleteParams extends SmartleadCampaignIdParams {
  campaignLeadMapId: number
}

export const markLeadCompleteTool: ToolConfig<
  MarkLeadCompleteParams,
  SmartleadMarkCompleteResponse
> = {
  id: 'smartlead_mark_lead_complete',
  name: 'Smartlead Mark Lead Complete',
  description:
    'Marks a lead as completed in a Smartlead campaign so it stops receiving further sequence steps.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    campaignLeadMapId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The campaign_lead_map_id from List Campaign Leads — this endpoint takes the map ID, NOT lead.id',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(
        `/campaigns/${pathSegment(params.campaignId)}/leads/${pathSegment(params.campaignLeadMapId)}/manual-complete`,
        params.apiKey
      ),
    method: 'POST',
    headers: smartleadHeaders,
    body: () => ({}),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead completion')
    const status = isRecordLike(record.status) ? record.status : {}

    return {
      success: true,
      output: {
        success: isOk(record),
        is_last_sequence: typeof status.isLastSequence === 'boolean' ? status.isLastSequence : null,
        next_sequence: typeof status.nextSequence === 'number' ? status.nextSequence : null,
      },
    }
  },
  outputs: markCompleteOutputs,
}
