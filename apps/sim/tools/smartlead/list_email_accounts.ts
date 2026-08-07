import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadBaseParams, SmartleadEmailAccountsResponse } from '@/tools/smartlead/types'
import {
  emailAccountsOutputs,
  mapEmailAccount,
  smartleadArray,
  smartleadBaseParamFields,
  smartleadHeaders,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface ListEmailAccountsParams extends SmartleadBaseParams {
  offset?: number
  limit?: number
  clientId?: number
}

export const listEmailAccountsTool: ToolConfig<
  ListEmailAccountsParams,
  SmartleadEmailAccountsResponse
> = {
  id: 'smartlead_list_email_accounts',
  name: 'Smartlead List Email Accounts',
  description:
    'Retrieves the sending email accounts on the Smartlead account, including their IDs for attaching to a campaign.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset (default 0)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accounts to return per page (default 100)',
    },
    clientId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return accounts for this client (agency accounts)',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl('/email-accounts/', params.apiKey, {
        offset: params.offset,
        limit: params.limit,
        client_id: params.clientId,
      }),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const rows = await smartleadArray(response, 'email accounts')
    const accounts = rows.map(mapEmailAccount)

    return {
      success: true,
      output: { accounts, count: accounts.length },
    }
  },
  outputs: emailAccountsOutputs,
}
