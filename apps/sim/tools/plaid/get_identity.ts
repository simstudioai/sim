import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaidGetIdentityParams, PlaidGetIdentityResponse } from '@/tools/plaid/types'
import {
  PLAID_ACCOUNT_OUTPUT_PROPERTIES,
  PLAID_IDENTITY_OWNER_OUTPUT_PROPERTIES,
  PLAID_REQUEST_ID_OUTPUT_PROPERTY,
} from '@/tools/plaid/types'
import {
  buildPlaidInternalBody,
  mapPlaidIdentityAccount,
  plaidBaseParamFields,
  plaidRecord,
  requirePlaidArrayField,
  requirePlaidStringField,
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
    accountIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated account IDs to filter to (defaults to all accounts)',
    },
  },

  request: {
    url: '/api/tools/plaid',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const accountIds = splitPlaidList(params.accountIds, 'accountIds')
      return buildPlaidInternalBody('plaid_get_identity', params, {
        account_ids: accountIds,
      })
    },
    internalAuth: 'executor_delegation',
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'identity')
    const accounts = requirePlaidArrayField(data, 'accounts', 'identity.accounts')
    const mapped = accounts.map((account, index) =>
      mapPlaidIdentityAccount(account, `identity.accounts[${index}]`)
    )
    return {
      success: true,
      output: {
        requestId: requirePlaidStringField(data, 'request_id', 'identity.request_id'),
        accounts: mapped,
        count: mapped.length,
      },
    }
  },

  outputs: {
    requestId: PLAID_REQUEST_ID_OUTPUT_PROPERTY,
    accounts: {
      type: 'array',
      description: 'Accounts with their owners identity data',
      items: {
        type: 'object',
        properties: {
          ...PLAID_ACCOUNT_OUTPUT_PROPERTIES,
          owners: {
            type: 'array',
            description: 'Account owners with names, phone numbers, emails, and addresses',
            items: { type: 'object', properties: PLAID_IDENTITY_OWNER_OUTPUT_PROPERTIES },
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of accounts returned' },
  },
}
