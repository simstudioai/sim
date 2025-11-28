import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonUpdateAccount')

export interface PylonUpdateAccountParams {
  apiToken: string
  accountId: string
  name?: string
  domains?: string
  primaryDomain?: string
  customFields?: string
  tags?: string
  channels?: string
  externalIds?: string
  ownerId?: string
  logoUrl?: string
  subaccountIds?: string
}

export interface PylonUpdateAccountResponse {
  success: boolean
  output: {
    account: any
    metadata: {
      operation: 'update_account'
      accountId: string
    }
    success: boolean
  }
}

export const pylonUpdateAccountTool: ToolConfig<
  PylonUpdateAccountParams,
  PylonUpdateAccountResponse
> = {
  id: 'pylon_update_account',
  name: 'Update Account in Pylon',
  description: 'Update an existing account with new properties',
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
      description: 'Account ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account name',
    },
    domains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of domains',
    },
    primaryDomain: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Primary domain for the account',
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
    channels: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated channel IDs',
    },
    externalIds: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated external IDs',
    },
    ownerId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Owner user ID',
    },
    logoUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'URL to account logo',
    },
    subaccountIds: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated subaccount IDs',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/accounts/${params.accountId}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {}

      if (params.name) body.name = params.name
      if (params.primaryDomain) body.primary_domain = params.primaryDomain
      if (params.ownerId) body.owner_id = params.ownerId
      if (params.logoUrl) body.logo_url = params.logoUrl

      if (params.domains) {
        body.domains = params.domains.split(',').map((d) => d.trim())
      }

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

      if (params.channels) {
        body.channels = params.channels.split(',').map((c) => c.trim())
      }

      if (params.externalIds) {
        body.external_ids = params.externalIds.split(',').map((e) => e.trim())
      }

      if (params.subaccountIds) {
        body.subaccount_ids = params.subaccountIds.split(',').map((s) => s.trim())
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'update_account')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        account: data.data,
        metadata: {
          operation: 'update_account' as const,
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
      description: 'Updated account data',
      properties: {
        account: { type: 'object', description: 'Updated account object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
