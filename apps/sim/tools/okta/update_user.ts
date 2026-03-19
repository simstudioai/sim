import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaApiError,
  OktaUpdateUserParams,
  OktaUpdateUserResponse,
  OktaUser,
} from '@/tools/okta/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaUpdateUser')

export const oktaUpdateUserTool: ToolConfig<OktaUpdateUserParams, OktaUpdateUserResponse> = {
  id: 'okta_update_user',
  name: 'Update User in Okta',
  description: 'Update a user profile in your Okta organization',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta API token for authentication',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta domain (e.g., dev-123456.okta.com)',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID or login to update',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated first name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated last name',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated email address',
    },
    login: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated login',
    },
    mobilePhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated mobile phone number',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated job title',
    },
    department: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated department',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/users/${encodeURIComponent(params.userId)}`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `SSWS ${params.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const profile: Record<string, string> = {}

      if (params.firstName !== undefined) profile.firstName = params.firstName
      if (params.lastName !== undefined) profile.lastName = params.lastName
      if (params.email !== undefined) profile.email = params.email
      if (params.login !== undefined) profile.login = params.login
      if (params.mobilePhone !== undefined) profile.mobilePhone = params.mobilePhone
      if (params.title !== undefined) profile.title = params.title
      if (params.department !== undefined) profile.department = params.department

      return { profile }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      let error: OktaApiError = {}
      try {
        error = await response.json()
      } catch {
        // non-JSON error body
      }
      logger.error('Okta API request failed', { data: error, status: response.status })
      throw new Error(error.errorSummary || 'Failed to update user in Okta')
    }

    const user: OktaUser = await response.json()
    return {
      success: true,
      output: {
        id: user.id,
        status: user.status,
        firstName: user.profile?.firstName ?? null,
        lastName: user.profile?.lastName ?? null,
        email: user.profile?.email ?? null,
        login: user.profile?.login ?? null,
        created: user.created,
        lastUpdated: user.lastUpdated,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'User ID' },
    status: { type: 'string', description: 'User status' },
    firstName: { type: 'string', description: 'First name', optional: true },
    lastName: { type: 'string', description: 'Last name', optional: true },
    email: { type: 'string', description: 'Email address', optional: true },
    login: { type: 'string', description: 'Login', optional: true },
    created: { type: 'string', description: 'Creation timestamp' },
    lastUpdated: { type: 'string', description: 'Last update timestamp' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
