import { createLogger } from '@/lib/logs/console/logger'
import type {
  SalesforceGetAccountsParams,
  SalesforceGetAccountsResponse,
} from '@/tools/salesforce/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceGetAccounts')

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
      visibility: 'user-only',
      description: 'Number of results to return (default: 100, max: 2000)',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of fields to return (e.g., "Id,Name,Industry,Phone")',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Field to order by (e.g., "Name ASC" or "CreatedDate DESC")',
    },
  },

  request: {
    url: (params) => {
      let instanceUrl = params.instanceUrl

      if (!instanceUrl && params.idToken) {
        try {
          const base64Url = params.idToken.split('.')[1]
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
          const jsonPayload = decodeURIComponent(
            atob(base64)
              .split('')
              .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
              .join('')
          )
          const decoded = JSON.parse(jsonPayload)

          if (decoded.profile) {
            const match = decoded.profile.match(/^(https:\/\/[^/]+)/)
            if (match) {
              instanceUrl = match[1]
            }
          } else if (decoded.sub) {
            const match = decoded.sub.match(/^(https:\/\/[^/]+)/)
            if (match && match[1] !== 'https://login.salesforce.com') {
              instanceUrl = match[1]
            }
          }
        } catch (error) {
          logger.error('Failed to decode Salesforce idToken', { error })
        }
      }

      if (!instanceUrl) {
        throw new Error('Salesforce instance URL is required but not provided')
      }

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
      logger.error('Salesforce API request failed', { data, status: response.status })
      throw new Error(
        data[0]?.message || data.message || 'Failed to fetch accounts from Salesforce'
      )
    }

    const accounts = data.records || []

    return {
      success: true,
      output: {
        accounts,
        paging: {
          nextRecordsUrl: data.nextRecordsUrl,
          totalSize: data.totalSize || accounts.length,
          done: data.done !== false,
        },
        metadata: {
          operation: 'get_accounts' as const,
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
        accounts: {
          type: 'array',
          description: 'Array of account objects',
        },
        paging: {
          type: 'object',
          description: 'Pagination information',
        },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
        },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
