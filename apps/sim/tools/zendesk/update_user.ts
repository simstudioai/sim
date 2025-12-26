import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskUpdateUser')

export interface ZendeskUpdateUserParams {
  email: string
  apiToken: string
  subdomain: string
  userId: string
  name?: string
  userEmail?: string
  role?: string
  phone?: string
  organizationId?: string
  verified?: string
  tags?: string
  customFields?: string
}

export interface ZendeskUpdateUserResponse {
  success: boolean
  output: {
    user: any
    metadata: {
      operation: 'update_user'
      userId: string
    }
    success: boolean
  }
}

export const zendeskUpdateUserTool: ToolConfig<ZendeskUpdateUserParams, ZendeskUpdateUserResponse> =
  {
    id: 'zendesk_update_user',
    name: 'Update User in Zendesk',
    description: 'Update an existing user in Zendesk',
    version: '1.0.0',

    params: {
      email: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Your Zendesk email address',
      },
      apiToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Zendesk API token',
      },
      subdomain: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Your Zendesk subdomain',
      },
      userId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'User ID to update',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'New user name',
      },
      userEmail: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'New user email',
      },
      role: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'User role (end-user, agent, admin)',
      },
      phone: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'User phone number',
      },
      organizationId: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Organization ID',
      },
      verified: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Set to "true" to mark user as verified',
      },
      tags: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Comma-separated tags',
      },
      customFields: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Custom fields as JSON object',
      },
    },

    request: {
      url: (params) => buildZendeskUrl(params.subdomain, `/users/${params.userId}`),
      method: 'PUT',
      headers: (params) => {
        const credentials = `${params.email}/token:${params.apiToken}`
        const base64Credentials = Buffer.from(credentials).toString('base64')
        return {
          Authorization: `Basic ${base64Credentials}`,
          'Content-Type': 'application/json',
        }
      },
      body: (params) => {
        const user: any = {}

        if (params.name) user.name = params.name
        if (params.userEmail) user.email = params.userEmail
        if (params.role) user.role = params.role
        if (params.phone) user.phone = params.phone
        if (params.organizationId) user.organization_id = params.organizationId
        if (params.verified) user.verified = params.verified === 'true'
        if (params.tags) user.tags = params.tags.split(',').map((t) => t.trim())

        if (params.customFields) {
          try {
            const customFields = JSON.parse(params.customFields)
            user.user_fields = customFields
          } catch (error) {
            logger.warn('Failed to parse custom fields', { error })
          }
        }

        return { user }
      },
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const data = await response.json()
        handleZendeskError(data, response.status, 'update_user')
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          user: data.user,
          metadata: {
            operation: 'update_user' as const,
            userId: data.user?.id,
          },
          success: true,
        },
      }
    },

    outputs: {
      user: { type: 'object', description: 'Updated user object' },
      metadata: { type: 'object', description: 'Operation metadata' },
    },
  }
