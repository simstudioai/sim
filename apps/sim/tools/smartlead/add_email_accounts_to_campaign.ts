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

interface AddEmailAccountsParams extends SmartleadCampaignIdParams {
  emailAccountIds: number[]
}

export const addEmailAccountsToCampaignTool: ToolConfig<
  AddEmailAccountsParams,
  SmartleadActionResponse
> = {
  id: 'smartlead_add_email_accounts_to_campaign',
  name: 'Smartlead Add Email Accounts to Campaign',
  description:
    'Attaches sending email accounts to a Smartlead campaign. A campaign needs at least one attached account before it can start.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    emailAccountIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'IDs of the email accounts to attach, from List Email Accounts',
      items: { type: 'number' },
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/email-accounts`, params.apiKey),
    method: 'POST',
    headers: smartleadHeaders,
    body: (params) => ({
      email_account_ids: Array.isArray(params.emailAccountIds) ? params.emailAccountIds : [],
    }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'email account attach')

    return {
      success: true,
      output: { success: isOk(record) || record.success === true },
    }
  },
  outputs: actionOutputs,
}
