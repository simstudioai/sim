import type { BrexGetCashAccountParams, BrexGetCashAccountResponse } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexGetCashAccountTool: ToolConfig<
  BrexGetCashAccountParams,
  BrexGetCashAccountResponse
> = {
  id: 'brex_get_cash_account',
  name: 'Brex Get Cash Account',
  description: 'Get a Brex cash account by ID, or the primary cash account when no ID is provided',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the cash account (defaults to the primary cash account)',
    },
  },

  request: {
    url: (params) => {
      const accountId = params.accountId?.trim()
      return accountId
        ? `${BREX_API_BASE}/v2/accounts/cash/${encodeURIComponent(accountId)}`
        : `${BREX_API_BASE}/v2/accounts/cash/primary`
    },
    method: 'GET',
    headers: (params) => buildBrexHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parseBrexJson(response)
    return {
      success: true,
      output: {
        id: data.id ?? '',
        name: data.name ?? '',
        status: data.status ?? null,
        currentBalance: data.current_balance,
        availableBalance: data.available_balance,
        accountNumber: data.account_number ?? '',
        routingNumber: data.routing_number ?? '',
        primary: data.primary ?? false,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique account ID' },
    name: { type: 'string', description: 'Account name' },
    status: { type: 'string', description: 'Account status', optional: true },
    currentBalance: {
      type: 'json',
      description: 'Current balance',
      properties: BREX_MONEY_PROPERTIES,
    },
    availableBalance: {
      type: 'json',
      description: 'Available balance',
      properties: BREX_MONEY_PROPERTIES,
    },
    accountNumber: { type: 'string', description: 'Bank account number' },
    routingNumber: { type: 'string', description: 'Bank routing number' },
    primary: { type: 'boolean', description: 'Whether this is the primary cash account' },
  },
}
