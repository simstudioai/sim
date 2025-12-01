import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonBulkUpdateAccounts')

export interface PylonBulkUpdateAccountsParams {
  apiToken: string
  accountIds: string
  customFields?: string
  tags?: string
  ownerId?: string
  tagsApplyMode?: string
}

export interface PylonBulkUpdateAccountsResponse {
  success: boolean
  output: {
    accounts: any[]
    metadata: {
      operation: 'bulk_update_accounts'
      totalUpdated: number
    }
    success: boolean
  }
}

export const pylonBulkUpdateAccountsTool: ToolConfig<
  PylonBulkUpdateAccountsParams,
  PylonBulkUpdateAccountsResponse
> = {
  id: 'pylon_bulk_update_accounts',
  name: 'Bulk Update Accounts in Pylon',
  description: 'Update multiple accounts at once',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    accountIds: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Comma-separated account IDs to update',
    },
    customFields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Custom fields as JSON object',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated tag IDs',
    },
    ownerId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Owner user ID',
    },
    tagsApplyMode: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Tag application mode: append_only, remove_only, or replace',
    },
  },

  request: {
    url: () => buildPylonUrl('/accounts'),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {
        account_ids: params.accountIds.split(',').map((id) => id.trim()),
      }

      if (params.ownerId) body.owner_id = params.ownerId
      if (params.tagsApplyMode) body.tags_apply_mode = params.tagsApplyMode

      if (params.customFields) {
        try {
          body.custom_fields = JSON.parse(params.customFields)
        } catch (error) {
          logger.warn('Failed to parse custom fields', { error })
        }
      }

      if (params.tags) {
        body.tags = params.tags.split(',').map((t) => t.trim())
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'bulk_update_accounts')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        accounts: data.data || [],
        metadata: {
          operation: 'bulk_update_accounts' as const,
          totalUpdated: data.data?.length || 0,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Bulk updated accounts data',
      properties: {
        accounts: { type: 'array', description: 'Array of updated account objects' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
