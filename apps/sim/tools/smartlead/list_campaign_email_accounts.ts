import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadEmailAccountsResponse,
} from '@/tools/smartlead/types'
import {
  emailAccountsOutputs,
  mapEmailAccount,
  pathSegment,
  smartleadArray,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const listCampaignEmailAccountsTool: ToolConfig<
  SmartleadCampaignIdParams,
  SmartleadEmailAccountsResponse
> = {
  id: 'smartlead_list_campaign_email_accounts',
  name: 'Smartlead List Campaign Email Accounts',
  description: 'Retrieves the sending email accounts attached to a Smartlead campaign.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/email-accounts`, params.apiKey),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const rows = await smartleadArray(response, 'campaign email accounts')
    const accounts = rows.map(mapEmailAccount)

    return {
      success: true,
      output: { accounts, count: accounts.length },
    }
  },
  outputs: emailAccountsOutputs,
}
