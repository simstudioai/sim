import type { BrexApiKeyParams, BrexListCardAccountsResponse } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexListCardAccountsTool: ToolConfig<BrexApiKeyParams, BrexListCardAccountsResponse> =
  {
    id: 'brex_list_card_accounts',
    name: 'Brex List Card Accounts',
    description: 'List all Brex card accounts with balances and limits',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
      },
    },

    request: {
      url: `${BREX_API_BASE}/v2/accounts/card`,
      method: 'GET',
      headers: (params) => buildBrexHeaders(params.apiKey),
    },

    transformResponse: async (response) => {
      const data = await parseBrexJson(response)
      return {
        success: true,
        output: {
          accounts: Array.isArray(data) ? data : [],
        },
      }
    },

    outputs: {
      accounts: {
        type: 'array',
        description: 'Card accounts',
        items: {
          type: 'json',
          properties: {
            id: { type: 'string', description: 'Unique account ID' },
            status: { type: 'string', description: 'Account status', optional: true },
            current_balance: {
              type: 'json',
              description: 'Current balance',
              optional: true,
              properties: BREX_MONEY_PROPERTIES,
            },
            available_balance: {
              type: 'json',
              description: 'Available balance',
              optional: true,
              properties: BREX_MONEY_PROPERTIES,
            },
            account_limit: {
              type: 'json',
              description: 'Account limit',
              optional: true,
              properties: BREX_MONEY_PROPERTIES,
            },
            current_statement_period: {
              type: 'json',
              description: 'Current statement period (start_date, end_date)',
            },
          },
        },
      },
    },
  }
