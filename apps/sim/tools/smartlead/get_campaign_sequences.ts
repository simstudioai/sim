import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadCampaignIdParams, SmartleadSequencesResponse } from '@/tools/smartlead/types'
import {
  mapSequence,
  pathSegment,
  sequenceOutputs,
  smartleadArray,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const getCampaignSequencesTool: ToolConfig<
  SmartleadCampaignIdParams,
  SmartleadSequencesResponse
> = {
  id: 'smartlead_get_campaign_sequences',
  name: 'Smartlead Get Campaign Sequences',
  description:
    'Retrieves the email sequence steps for a Smartlead campaign, including subjects, bodies, and per-step delays.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/sequences`, params.apiKey),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const data = await smartleadArray(response, 'sequences')
    const sequences = data.map(mapSequence)

    return {
      success: true,
      output: {
        sequences,
        count: sequences.length,
      },
    }
  },
  outputs: sequenceOutputs,
}
