import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaidGetAuthParams, PlaidGetAuthResponse } from '@/tools/plaid/types'
import {
  buildPlaidInternalBody,
  mapPlaidAccount,
  mapPlaidNumbers,
  plaidAccessTokenParamField,
  plaidAccountOutputProperties,
  plaidBaseParamFields,
  plaidNumbersOutputProperties,
  plaidRecord,
  requirePlaidArrayField,
  splitPlaidList,
} from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidGetAuthTool: ToolConfig<PlaidGetAuthParams, PlaidGetAuthResponse> = {
  id: 'plaid_get_auth',
  name: 'Plaid Get Auth',
  description:
    'Get account and routing numbers for depository accounts linked to an Item (ACH for US, EFT for Canada, BACS for UK, IBAN/BIC internationally). Check verification_status before use; null or empty means neither micro-deposit nor database verification applies',
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
      return buildPlaidInternalBody('plaid_get_auth', params, {
        account_ids: accountIds,
      })
    },
    internalAuth: 'executor_delegation',
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'auth')
    const accounts = requirePlaidArrayField(data, 'accounts', 'auth.accounts')
    return {
      success: true,
      output: {
        accounts: accounts.map((account, index) =>
          mapPlaidAccount(account, `auth.accounts[${index}]`)
        ),
        numbers: mapPlaidNumbers(data.numbers),
      },
    }
  },

  outputs: {
    accounts: {
      type: 'array',
      description: 'Depository accounts on the Item',
      items: { type: 'object', properties: plaidAccountOutputProperties },
    },
    numbers: {
      type: 'object',
      description: 'Account and routing numbers grouped by scheme',
      properties: plaidNumbersOutputProperties,
    },
  },
}
