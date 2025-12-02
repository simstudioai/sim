import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonDeleteAccount')

export interface PylonDeleteAccountParams {
  apiToken: string
  accountId: string
}

export interface PylonDeleteAccountResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'delete_account'
      accountId: string
    }
    success: boolean
  }
}

export const pylonDeleteAccountTool: ToolConfig<
  PylonDeleteAccountParams,
  PylonDeleteAccountResponse
> = {
  id: 'pylon_delete_account',
  name: 'Delete Account from Pylon',
  description: 'Remove an account by ID',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Account ID to delete',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/accounts/${params.accountId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'delete_account')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'delete_account' as const,
          accountId: '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deletion confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
