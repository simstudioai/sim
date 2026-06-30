import type {
  SalesforceGetAccountsParams,
  SalesforceGetAccountsResponse,
} from '@/tools/salesforce/types'
import { QUERY_PAGING_OUTPUT, RESPONSE_METADATA_OUTPUT } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

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
      description: 'Maximum number of results (default: 100, max: 2000)',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated field API names (e.g., "Id,Name,Industry,Phone")',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field and direction for sorting (e.g., "Name ASC" or "CreatedDate DESC")',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)

      const limit = params.limit ? Number.parseInt(params.limit) : 100
      const fields =
        params.fields ||
        'Id,Name,Type,Industry,BillingCity,BillingState,BillingCountry,Phone,Website'
      const orderBy = params.orderBy || 'Name ASC'

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
