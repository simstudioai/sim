import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaidGetIdentityParams, PlaidGetIdentityResponse } from '@/tools/plaid/types'
import {
  buildPlaidHeaders,
  mapPlaidIdentityAccount,
  plaidAccessTokenParamField,
  plaidAccountOutputProperties,
  plaidBaseParamFields,
  plaidBody,
  plaidRecord,
  plaidUrl,
  splitPlaidList,
} from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidGetIdentityTool: ToolConfig<PlaidGetIdentityParams, PlaidGetIdentityResponse> = {
  id: 'plaid_get_identity',
  name: 'Plaid Get Identity',
  description:
    'Get account-holder identity information (names, emails, phone numbers, and addresses) for the accounts linked to an Item',
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
    url: (params) => plaidUrl(params, '/identity/get'),
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
    const data = await plaidRecord(response, 'identity')
    const accounts = Array.isArray(data.accounts) ? data.accounts : []
    const mapped = accounts.map(mapPlaidIdentityAccount)
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
      description: 'Accounts with their owners identity data',
      items: {
        type: 'json',
        properties: {
          ...plaidAccountOutputProperties,
          owners: {
            type: 'json',
            description:
              'Account owners, each with names, phone_numbers, emails, and addresses arrays',
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of accounts returned' },
  },
}
