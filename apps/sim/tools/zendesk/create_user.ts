import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskCreateUser')

export interface ZendeskCreateUserParams {
  email: string
  apiToken: string
  subdomain: string
  name: string
  userEmail?: string
  role?: string
  phone?: string
  organizationId?: string
  verified?: string
  tags?: string
  customFields?: string
}

export interface ZendeskCreateUserResponse {
  success: boolean
  output: {
    user: any
    metadata: {
      operation: 'create_user'
      userId: string
    }
    success: boolean
  }
}

export const zendeskCreateUserTool: ToolConfig<ZendeskCreateUserParams, ZendeskCreateUserResponse> =
  {
    id: 'zendesk_create_user',
    name: 'Create User in Zendesk',
    description: 'Create a new user in Zendesk',
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
      name: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'User name',
      },
      userEmail: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'User email',
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
        description: 'Set to "true" to skip email verification',
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
        description: 'Custom fields as JSON object (e.g., {"field_id": "value"})',
      },
    },

    request: {
      url: (params) => buildZendeskUrl(params.subdomain, '/users'),
      method: 'POST',
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
        handleZendeskError(data, response.status, 'create_user')
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          user: data.user,
          metadata: {
            operation: 'create_user' as const,
            userId: data.user?.id,
          },
          success: true,
        },
      }
    },

    outputs: {
      user: { type: 'object', description: 'Created user object' },
      metadata: { type: 'object', description: 'Operation metadata' },
    },
  }
