import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaidGetBalancesParams, PlaidGetBalancesResponse } from '@/tools/plaid/types'
import {
  buildPlaidHeaders,
  mapPlaidAccount,
  plaidAccessTokenParamField,
  plaidAccountOutputProperties,
  plaidBaseParamFields,
  plaidBody,
  plaidRecord,
  plaidUrl,
  splitPlaidList,
} from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidGetBalancesTool: ToolConfig<PlaidGetBalancesParams, PlaidGetBalancesResponse> = {
  id: 'plaid_get_balances',
  name: 'Plaid Get Balances',
  description:
    'Get real-time balances for the accounts linked to an Item. Forces a live fetch from the institution, so it can take up to 30 seconds',
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
    minLastUpdatedDatetime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Oldest acceptable balance timestamp (ISO 8601). Only required for Capital One non-depository accounts',
    },
  },

  request: {
    url: (params) => plaidUrl(params, '/accounts/balance/get'),
    method: 'POST',
    headers: (params) => buildPlaidHeaders(params),
    body: (params) => {
      const options = plaidBody({
        account_ids: splitPlaidList(params.accountIds),
        min_last_updated_datetime: params.minLastUpdatedDatetime?.trim() || undefined,
      })
      return plaidBody({
        access_token: params.accessToken.trim(),
        options: Object.keys(options).length > 0 ? options : undefined,
      })
    },
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'balances')
    const accounts = Array.isArray(data.accounts) ? data.accounts : []
    const mapped = accounts.map(mapPlaidAccount)
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
      description: 'Accounts with refreshed real-time balances',
      items: { type: 'json', properties: plaidAccountOutputProperties },
    },
    count: { type: 'number', description: 'Number of accounts returned' },
  },
}
