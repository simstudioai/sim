import type {
  SalesforceDeleteAccountParams,
  SalesforceDeleteAccountResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_DELETE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl, requireId } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

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
      visibility: 'user-or-llm',
      description: 'Salesforce Account ID to delete (18-character string starting with 001)',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      const accountId = requireId(params.accountId, 'Account ID')

      return `${instanceUrl}/services/data/v59.0/sobjects/Account/${accountId}`
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
      throw new Error(
        extractErrorMessage(data, response.status, 'Failed to delete account from Salesforce')
      )
    }

    return {
      success: true,
      output: {
        id: params?.accountId?.trim() || '',
        deleted: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deleted account data',
      properties: SOBJECT_DELETE_OUTPUT_PROPERTIES,
    },
  },
}
