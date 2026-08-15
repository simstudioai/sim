import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaidGetAuthParams, PlaidGetAuthResponse } from '@/tools/plaid/types'
import {
  buildPlaidHeaders,
  mapPlaidAccount,
  mapPlaidNumbers,
  plaidAccessTokenParamField,
  plaidAccountOutputProperties,
  plaidBaseParamFields,
  plaidBody,
  plaidRecord,
  plaidUrl,
  splitPlaidList,
} from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidGetAuthTool: ToolConfig<PlaidGetAuthParams, PlaidGetAuthResponse> = {
  id: 'plaid_get_auth',
  name: 'Plaid Get Auth',
  description:
    'Get account and routing numbers for the depository accounts linked to an Item (ACH for US, EFT for Canada, BACS for UK, IBAN/BIC internationally). Check each account verification_status before relying on micro-deposit-verified accounts; null means the institution authenticated instantly',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLAID_ERRORS,

  params: {
    ...plaidBaseParamFields,
    ...plaidAccessTokenParamField,
    accountIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated account IDs to filter to (defaults to all accounts)',
    },
  },

  request: {
    url: (params) => plaidUrl(params, '/auth/get'),
    method: 'POST',
    headers: (params) => buildPlaidHeaders(params),
    body: (params) => {
      const accountIds = splitPlaidList(params.accountIds)
      return plaidBody({
        access_token: params.accessToken.trim(),
        options: accountIds ? { account_ids: accountIds } : undefined,
      })
    },
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'auth')
    const accounts = Array.isArray(data.accounts) ? data.accounts : []
    return {
      success: true,
      output: {
        accounts: accounts.map(mapPlaidAccount),
        numbers: mapPlaidNumbers(data.numbers),
      },
    }
  },

  outputs: {
    accounts: {
      type: 'array',
      description: 'Depository accounts on the Item',
      items: { type: 'json', properties: plaidAccountOutputProperties },
    },
    numbers: {
      type: 'json',
      description: 'Account and routing numbers grouped by scheme',
      properties: {
        ach: {
          type: 'json',
          description:
            'US accounts: account_id, account, routing, wire_routing, and is_tokenized_account_number entries (tokenized numbers come from institutions like Chase and stop working if the Item is deleted)',
        },
        eft: {
          type: 'json',
          description: 'Canadian accounts: account_id, account, institution, and branch entries',
        },
        international: {
          type: 'json',
          description: 'International accounts: account_id, iban, and bic entries',
        },
        bacs: {
          type: 'json',
          description: 'UK accounts: account_id, account, and sort_code entries',
        },
      },
    },
  },
}
