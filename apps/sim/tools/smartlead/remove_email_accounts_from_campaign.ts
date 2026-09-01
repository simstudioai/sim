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

interface RemoveEmailAccountsParams extends SmartleadCampaignIdParams {
  emailAccountIds: number[]
}

export const removeEmailAccountsFromCampaignTool: ToolConfig<
  RemoveEmailAccountsParams,
  SmartleadActionResponse
> = {
  id: 'smartlead_remove_email_accounts_from_campaign',
  name: 'Smartlead Remove Email Accounts from Campaign',
  description: 'Detaches sending email accounts from a Smartlead campaign.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    emailAccountIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'IDs of the email accounts to detach',
      items: { type: 'number' },
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/email-accounts`, params.apiKey),
    method: 'DELETE',
    headers: smartleadHeaders,
    body: (params) => ({
      email_account_ids: Array.isArray(params.emailAccountIds) ? params.emailAccountIds : [],
    }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'email account detach')

    return {
      success: true,
      output: { success: isOk(record) || record.success === true },
    }
  },
  outputs: actionOutputs,
}
