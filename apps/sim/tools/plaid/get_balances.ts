import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaidGetBalancesParams, PlaidGetBalancesResponse } from '@/tools/plaid/types'
import {
  PLAID_ACCOUNT_OUTPUT_PROPERTIES,
  PLAID_REQUEST_ID_OUTPUT_PROPERTY,
} from '@/tools/plaid/types'
import {
  buildPlaidInternalBody,
  mapPlaidAccount,
  plaidBaseParamFields,
  plaidRecord,
  requirePlaidArrayField,
  requirePlaidStringField,
  splitPlaidList,
  toPlaidOptionalDateTime,
} from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidGetBalancesTool: ToolConfig<PlaidGetBalancesParams, PlaidGetBalancesResponse> = {
  id: 'plaid_get_balances',
  name: 'Plaid Get Balances',
  description:
    'Get real-time balances for the accounts linked to an Item. The live institution fetch is usually under 10 seconds but can take 30 seconds or more',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLAID_ERRORS,

  params: {
    ...plaidBaseParamFields,
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
    url: '/api/tools/plaid',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) =>
      buildPlaidInternalBody('plaid_get_balances', params, {
        account_ids: splitPlaidList(params.accountIds, 'accountIds'),
        min_last_updated_datetime: toPlaidOptionalDateTime(
          params.minLastUpdatedDatetime,
          'minLastUpdatedDatetime'
        ),
      }),
    internalAuth: 'executor_delegation',
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'balances')
    const accounts = requirePlaidArrayField(data, 'accounts', 'balances.accounts')
    const mapped = accounts.map((account, index) =>
      mapPlaidAccount(account, `balances.accounts[${index}]`)
    )
    return {
      success: true,
      output: {
        requestId: requirePlaidStringField(data, 'request_id', 'balances.request_id'),
        accounts: mapped,
        count: mapped.length,
      },
    }
  },

  outputs: {
    requestId: PLAID_REQUEST_ID_OUTPUT_PROPERTY,
    accounts: {
      type: 'array',
      description: 'Accounts with refreshed real-time balances',
      items: { type: 'object', properties: PLAID_ACCOUNT_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of accounts returned' },
  },
}
