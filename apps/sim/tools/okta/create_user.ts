import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaApiError,
  OktaCreateUserParams,
  OktaCreateUserResponse,
  OktaUser,
} from '@/tools/okta/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaCreateUser')

export const oktaCreateUserTool: ToolConfig<OktaCreateUserParams, OktaCreateUserResponse> = {
  id: 'okta_create_user',
  name: 'Create User in Okta',
  description: 'Create a new user in your Okta organization',
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
    firstName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'First name of the user',
    },
    lastName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Last name of the user',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the user',
    },
    login: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Login for the user (defaults to email if not provided)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password for the user (if not set, user will be emailed to set password)',
    },
    mobilePhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mobile phone number',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job title',
    },
    department: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Department',
    },
    activate: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to activate the user immediately (default: true)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const activate = params.activate ?? true
      return `https://${domain}/api/v1/users?activate=${activate}`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `SSWS ${params.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const profile: Record<string, string> = {
        firstName: params.firstName,
        lastName: params.lastName,
        email: params.email,
        login: params.login || params.email,
      }

      if (params.mobilePhone) profile.mobilePhone = params.mobilePhone
      if (params.title) profile.title = params.title
      if (params.department) profile.department = params.department

      const body: Record<string, unknown> = { profile }

      if (params.password) {
        body.credentials = {
          password: { value: params.password },
        }
      }

      return body
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
      throw new Error(error.errorSummary || 'Failed to create user in Okta')
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
    id: { type: 'string', description: 'Created user ID' },
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
