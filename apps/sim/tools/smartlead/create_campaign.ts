import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadBaseParams, SmartleadCreateCampaignResponse } from '@/tools/smartlead/types'
import {
  createCampaignOutputs,
  jsonBody,
  mapCreatedCampaign,
  smartleadBaseParamFields,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface CreateCampaignParams extends SmartleadBaseParams {
  name: string
  clientId?: number
}

export const createCampaignTool: ToolConfig<CreateCampaignParams, SmartleadCreateCampaignResponse> =
  {
    id: 'smartlead_create_campaign',
    name: 'Smartlead Create Campaign',
    description:
      'Creates a Smartlead campaign. The campaign starts in DRAFTED status; add sequences, email accounts, and a schedule before starting it.',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
    params: {
      ...smartleadBaseParamFields,
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Campaign name',
      },
      clientId: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Client to own the campaign (agency accounts)',
      },
    },
    request: {
      url: (params) => smartleadUrl('/campaigns/create', params.apiKey),
      method: 'POST',
      headers: smartleadHeaders,
      body: (params) =>
        jsonBody({
          name: params.name,
          client_id: params.clientId,
        }),
    },
    transformResponse: async (response) => {
      const record = await smartleadRecord(response, 'campaign')

      return {
        success: true,
        output: mapCreatedCampaign(record),
      }
    },
    outputs: createCampaignOutputs,
  }
