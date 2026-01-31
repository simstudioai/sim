import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError, USER_OUTPUT_PROPERTIES } from '@/tools/zendesk/types'

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
    user_id: number
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
        visibility: 'user-or-llm',
        description: 'User ID to update as a numeric string (e.g., "12345")',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New user full name (e.g., "John Smith")',
      },
      userEmail: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New user email address (e.g., "john@example.com")',
      },
      role: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'User role: "end-user", "agent", or "admin"',
      },
      phone: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'User phone number (e.g., "+1-555-123-4567")',
      },
      organizationId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Organization ID as a numeric string (e.g., "67890")',
      },
      verified: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Set to "true" to mark user as verified, or "false" otherwise',
      },
      tags: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated tags (e.g., "vip, enterprise")',
      },
      customFields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Custom fields as JSON object (e.g., {"field_id": "value"})',
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
          user_id: data.user?.id,
          success: true,
        },
      }
    },

    outputs: {
      user: {
        type: 'object',
        description: 'Updated user object',
        properties: USER_OUTPUT_PROPERTIES,
      },
      user_id: { type: 'number', description: 'The updated user ID' },
    },
  }
