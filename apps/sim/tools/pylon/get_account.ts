import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonGetAccount')

export interface PylonGetAccountParams {
  apiToken: string
  accountId: string
}

export interface PylonGetAccountResponse {
  success: boolean
  output: {
    account: any
    metadata: {
      operation: 'get_account'
      accountId: string
    }
    success: boolean
  }
}

export const pylonGetAccountTool: ToolConfig<PylonGetAccountParams, PylonGetAccountResponse> = {
  id: 'pylon_get_account',
  name: 'Get Account from Pylon',
  description: 'Retrieve a single account by ID',
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
      description: 'Account ID to retrieve',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/accounts/${params.accountId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'get_account')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        account: data.data,
        metadata: {
          operation: 'get_account' as const,
          accountId: data.data?.id || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Account data',
      properties: {
        account: { type: 'object', description: 'Account object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
