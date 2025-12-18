import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { getInstanceUrl } from './utils'

const logger = createLogger('SalesforceDeleteAccount')

export interface SalesforceDeleteAccountParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  accountId: string
}

export interface SalesforceDeleteAccountResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
    metadata: {
      operation: 'delete_account'
    }
  }
}

export const salesforceDeleteAccountTool: ToolConfig<
  SalesforceDeleteAccountParams,
  SalesforceDeleteAccountResponse
> = {
  id: 'salesforce_delete_account',
  name: 'Delete Account from Salesforce',
  description: 'Delete an account from Salesforce CRM',
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
    },
    idToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
    },
    instanceUrl: {
      type: 'string',
      required: false,
      visibility: 'hidden',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Account ID to delete (required)',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/sobjects/Account/${params.accountId}`
    },
    method: 'DELETE',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      logger.error('Salesforce API request failed', { data, status: response.status })
      throw new Error(
        data[0]?.message || data.message || 'Failed to delete account from Salesforce'
      )
    }

    return {
      success: true,
      output: {
        id: params?.accountId || '',
        deleted: true,
        metadata: {
          operation: 'delete_account' as const,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deleted account data',
      properties: {
        id: { type: 'string', description: 'Deleted account ID' },
        deleted: { type: 'boolean', description: 'Whether account was deleted' },
        metadata: { type: 'object', description: 'Operation metadata' },
      },
    },
  },
}
