import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonUpdateContact')

export interface PylonUpdateContactParams {
  apiToken: string
  contactId: string
  name?: string
  email?: string
  accountId?: string
  accountExternalId?: string
  avatarUrl?: string
  customFields?: string
  portalRole?: string
}

export interface PylonUpdateContactResponse {
  success: boolean
  output: {
    contact: any
    metadata: {
      operation: 'update_contact'
      contactId: string
    }
    success: boolean
  }
}

export const pylonUpdateContactTool: ToolConfig<
  PylonUpdateContactParams,
  PylonUpdateContactResponse
> = {
  id: 'pylon_update_contact',
  name: 'Update Contact in Pylon',
  description: 'Update an existing contact with specified properties',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Contact ID to update',
    },
    name: {
      type: 'string',
      required: false,
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
    url: (params) => buildPylonUrl(`/contacts/${params.contactId}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {}

      if (params.name) body.name = params.name
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
      handlePylonError(data, response.status, 'update_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contact: data.data,
        metadata: {
          operation: 'update_contact' as const,
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
      description: 'Updated contact data',
      properties: {
        contact: { type: 'object', description: 'Updated contact object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
