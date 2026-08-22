import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaUpdateUserParams, OktaUpdateUserResponse, OktaUser } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
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
      return `https://${domain}/api/v1/users/${encodeURIComponent(params.userId.trim())}`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
    /**
     * Blank values are dropped rather than sent.
     *
     * This is a partial merge, so any key present in `profile` overwrites the
     * stored value — an empty string blanks the field in Okta. The block strips
     * blanks before they reach here, but this tool is also `user-or-llm` and a
     * model routinely emits `""` for a field it has nothing to say about, so
     * the guard has to live on the tool itself.
     */
    body: (params) => {
      const profile: Record<string, string> = {}

      if (params.firstName) profile.firstName = params.firstName
      if (params.lastName) profile.lastName = params.lastName
      if (params.email) profile.email = params.email
      if (params.login) profile.login = params.login
      if (params.mobilePhone) profile.mobilePhone = params.mobilePhone
      if (params.title) profile.title = params.title
      if (params.department) profile.department = params.department

      return { profile }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to update user in Okta')
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
