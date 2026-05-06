import type {
  EmailBisonBaseParams,
  EmailBisonListCampaignsResponse,
} from '@/tools/emailbison/types'
import {
  emailBisonArrayData,
  emailBisonHeaders,
  emailBisonUrl,
  listCampaignsOutputs,
  mapCampaign,
} from '@/tools/emailbison/utils'
import type { ToolConfig } from '@/tools/types'

export const listCampaignsTool: ToolConfig<EmailBisonBaseParams, EmailBisonListCampaignsResponse> =
  {
    id: 'emailbison_list_campaigns',
    name: 'Email Bison List Campaigns',
    description: 'Retrieves Email Bison campaigns.',
    version: '1.0.0',
    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Email Bison API token',
      },
    },
    request: {
      url: () => emailBisonUrl('/api/campaigns'),
      method: 'GET',
      headers: emailBisonHeaders,
    },
    transformResponse: async (response) => {
      const data = await emailBisonArrayData(response, 'campaigns')
      const campaigns = data.map(mapCampaign)

      return {
        success: true,
        output: {
          campaigns,
          count: campaigns.length,
        },
      }
    },
    outputs: listCampaignsOutputs,
  }
