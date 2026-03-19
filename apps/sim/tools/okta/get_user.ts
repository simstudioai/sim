import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaApiError,
  OktaGetUserParams,
  OktaGetUserResponse,
  OktaUser,
} from '@/tools/okta/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaGetUser')

export const oktaGetUserTool: ToolConfig<OktaGetUserParams, OktaGetUserResponse> = {
  id: 'okta_get_user',
  name: 'Get User from Okta',
  description: 'Get a specific user by ID or login from your Okta organization',
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
      description: 'User ID or login (email) to look up',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/users/${encodeURIComponent(params.userId)}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `SSWS ${params.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
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
      throw new Error(error.errorSummary || 'Failed to get user from Okta')
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
        mobilePhone: user.profile?.mobilePhone ?? null,
        secondEmail: user.profile?.secondEmail ?? null,
        displayName: user.profile?.displayName ?? null,
        title: user.profile?.title ?? null,
        department: user.profile?.department ?? null,
        organization: user.profile?.organization ?? null,
        manager: user.profile?.manager ?? null,
        managerId: user.profile?.managerId ?? null,
        division: user.profile?.division ?? null,
        employeeNumber: user.profile?.employeeNumber ?? null,
        userType: user.profile?.userType ?? null,
        created: user.created,
        activated: user.activated ?? null,
        lastLogin: user.lastLogin ?? null,
        lastUpdated: user.lastUpdated,
        statusChanged: user.statusChanged ?? null,
        passwordChanged: user.passwordChanged ?? null,
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
    login: { type: 'string', description: 'Login (usually email)', optional: true },
    mobilePhone: { type: 'string', description: 'Mobile phone', optional: true },
    secondEmail: { type: 'string', description: 'Secondary email', optional: true },
    displayName: { type: 'string', description: 'Display name', optional: true },
    title: { type: 'string', description: 'Job title', optional: true },
    department: { type: 'string', description: 'Department', optional: true },
    organization: { type: 'string', description: 'Organization', optional: true },
    manager: { type: 'string', description: 'Manager name', optional: true },
    managerId: { type: 'string', description: 'Manager ID', optional: true },
    division: { type: 'string', description: 'Division', optional: true },
    employeeNumber: { type: 'string', description: 'Employee number', optional: true },
    userType: { type: 'string', description: 'User type', optional: true },
    created: { type: 'string', description: 'Creation timestamp' },
    activated: { type: 'string', description: 'Activation timestamp', optional: true },
    lastLogin: { type: 'string', description: 'Last login timestamp', optional: true },
    lastUpdated: { type: 'string', description: 'Last update timestamp' },
    statusChanged: { type: 'string', description: 'Status change timestamp', optional: true },
    passwordChanged: { type: 'string', description: 'Password change timestamp', optional: true },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
