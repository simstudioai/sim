import { toRecordOrNull } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type {
  YouComGetAccountBalanceParams,
  YouComGetAccountBalanceResponse,
} from '@/tools/youcom/types'
import { YOUCOM_API_BASE_URL, youComApiKeyParam, youComHeaders } from '@/tools/youcom/utils'

export const youComGetAccountBalanceTool: ToolConfig<
  YouComGetAccountBalanceParams,
  YouComGetAccountBalanceResponse
> = {
  id: 'youcom_get_account_balance',
  name: 'You.com Get Account Balance',
  description:
    'Get the remaining You.com API credit balance for the account or organization that owns the API key.',
  version: '1.0.0',

  params: {
    apiKey: youComApiKeyParam,
  },

  request: {
    url: `${YOUCOM_API_BASE_URL}/billing/account_balance`,
    method: 'GET',
    headers: youComHeaders,
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const account = toRecordOrNull(data.data) ?? {}
    const attributes = toRecordOrNull(account.attributes) ?? {}

    return {
      success: true,
      output: {
        accountId: String(account.id ?? ''),
        accountType: String(account.type ?? ''),
        balance: Number(attributes.balance ?? 0),
      },
    }
  },

  outputs: {
    accountId: {
      type: 'string',
      description: 'Stable hashed ID of the billing entity (user or organization)',
    },
    accountType: { type: 'string', description: 'Billing entity type (account)' },
    balance: {
      type: 'number',
      description: 'Remaining credit balance in cents (divide by 100 for USD)',
    },
  },
}
