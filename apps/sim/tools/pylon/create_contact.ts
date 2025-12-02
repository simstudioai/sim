import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonCreateContact')

export interface PylonCreateContactParams {
  apiToken: string
  name: string
  email?: string
  accountId?: string
  accountExternalId?: string
  avatarUrl?: string
  customFields?: string
  portalRole?: string
}

export interface PylonCreateContactResponse {
  success: boolean
  output: {
    contact: any
    metadata: {
      operation: 'create_contact'
      contactId: string
    }
    success: boolean
  }
}

export const pylonCreateContactTool: ToolConfig<
  PylonCreateContactParams,
  PylonCreateContactResponse
> = {
  id: 'pylon_create_contact',
  name: 'Create Contact in Pylon',
  description: 'Create a new contact with specified properties',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Contact name',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Contact email address',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account ID to associate with contact',
    },
    accountExternalId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'External account ID to associate with contact',
    },
    avatarUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'URL for contact avatar image',
    },
    customFields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Custom fields as JSON object',
    },
    portalRole: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Portal role for the contact',
    },
  },

  request: {
    url: () => buildPylonUrl('/contacts'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {
        name: params.name,
      }

      if (params.email) body.email = params.email
      if (params.accountId) body.account_id = params.accountId
      if (params.accountExternalId) body.account_external_id = params.accountExternalId
      if (params.avatarUrl) body.avatar_url = params.avatarUrl
      if (params.portalRole) body.portal_role = params.portalRole

      if (params.customFields) {
        try {
          body.custom_fields = JSON.parse(params.customFields)
        } catch (error) {
          logger.warn('Failed to parse custom fields', { error })
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'create_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contact: data.data,
        metadata: {
          operation: 'create_contact' as const,
          contactId: data.data?.id || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created contact data',
      properties: {
        contact: { type: 'object', description: 'Created contact object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
