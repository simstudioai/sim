import type {
  SalesforceGetAccountsParams,
  SalesforceGetAccountsResponse,
} from '@/tools/salesforce/types'
import { QUERY_PAGING_OUTPUT, RESPONSE_METADATA_OUTPUT } from '@/tools/salesforce/types'
import {
  extractErrorMessage,
  getInstanceUrl,
  sanitizeSoqlFieldList,
  sanitizeSoqlLimit,
  sanitizeSoqlOrderBy,
} from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

/** Field list used when the caller does not supply `fields`. */
const DEFAULT_FIELDS = 'Id,Name,Type,Industry,BillingCity,BillingState,BillingCountry,Phone,Website'

/** Sort clause used when the caller does not supply `orderBy`. */
const DEFAULT_ORDER_BY = 'Name ASC'

export const salesforceGetAccountsTool: ToolConfig<
  SalesforceGetAccountsParams,
  SalesforceGetAccountsResponse
> = {
  id: 'salesforce_get_accounts',
  name: 'Get Accounts from Salesforce',
  description: 'Retrieve accounts from Salesforce CRM',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Salesforce API',
    },
    idToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID token from Salesforce OAuth (contains instance URL)',
    },
    instanceUrl: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The Salesforce instance URL',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (default: 100)',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated field API names (e.g., "Id,Name,Industry,Phone") Also accepts FIELDS(STANDARD|CUSTOM|ALL) and toLabel()/FORMAT()/convertCurrency() around a single field.',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field and direction for sorting (e.g., "Name ASC" or "CreatedDate DESC") Bare field API names only, optionally with ASC/DESC and NULLS FIRST/LAST; SOQL functions such as DISTANCE() are not accepted here — use the Salesforce Query tool for those.',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)

      const limit = sanitizeSoqlLimit(params.limit)
      const fields = sanitizeSoqlFieldList(params.fields, DEFAULT_FIELDS)
      const orderBy = sanitizeSoqlOrderBy(params.orderBy, DEFAULT_ORDER_BY)

      // Build SOQL query
      const query = `SELECT ${fields} FROM Account ORDER BY ${orderBy} LIMIT ${limit}`
      const encodedQuery = encodeURIComponent(query)

      return `${instanceUrl}/services/data/v59.0/query?q=${encodedQuery}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        extractErrorMessage(data, response.status, 'Failed to fetch accounts from Salesforce')
      )
    }

    const accounts = data.records || []

    return {
      success: true,
      output: {
        accounts,
        paging: {
          nextRecordsUrl: data.nextRecordsUrl ?? null,
          totalSize: data.totalSize || accounts.length,
          done: data.done !== false,
        },
        metadata: {
          totalReturned: accounts.length,
          hasMore: !data.done,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Accounts data',
      properties: {
        accounts: { type: 'array', description: 'Array of account objects' },
        paging: QUERY_PAGING_OUTPUT,
        metadata: RESPONSE_METADATA_OUTPUT,
        success: { type: 'boolean', description: 'Salesforce operation success' },
      },
    },
  },
}
