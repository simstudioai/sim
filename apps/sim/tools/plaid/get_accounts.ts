import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaidGetAccountsParams, PlaidGetAccountsResponse } from '@/tools/plaid/types'
import {
  buildPlaidInternalBody,
  mapPlaidAccount,
  plaidAccessTokenParamField,
  plaidAccountOutputProperties,
  plaidBaseParamFields,
  plaidRecord,
  requirePlaidArrayField,
  splitPlaidList,
} from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidGetAccountsTool: ToolConfig<PlaidGetAccountsParams, PlaidGetAccountsResponse> = {
  id: 'plaid_get_accounts',
  name: 'Plaid Get Accounts',
  description:
    'List the accounts linked to an Item with their names, types, and balances. Balances may be cached; use Get Balances for real-time values',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLAID_ERRORS,

  params: {
    ...plaidBaseParamFields,
    ...plaidAccessTokenParamField,
    accountIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated account IDs to filter to (defaults to all accounts; Sim safety limit 500)',
    },
  },

  request: {
    url: '/api/tools/plaid',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const accountIds = splitPlaidList(params.accountIds, 'accountIds')
      return buildPlaidInternalBody('plaid_get_accounts', params, {
        account_ids: accountIds,
      })
    },
    internalAuth: 'executor_delegation',
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'accounts')
    const accounts = requirePlaidArrayField(data, 'accounts', 'accounts.accounts')
    const mapped = accounts.map((account, index) =>
      mapPlaidAccount(account, `accounts.accounts[${index}]`)
    )
    return {
      success: true,
      output: {
        accounts: mapped,
        count: mapped.length,
      },
    }
  },

  outputs: {
    accounts: {
      type: 'array',
      description: 'Accounts linked to the Item',
      items: { type: 'object', properties: plaidAccountOutputProperties },
    },
    count: { type: 'number', description: 'Number of accounts returned' },
  },
}
