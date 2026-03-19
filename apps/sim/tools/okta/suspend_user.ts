import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaApiError,
  OktaSuspendUserParams,
  OktaSuspendUserResponse,
} from '@/tools/okta/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaSuspendUser')

export const oktaSuspendUserTool: ToolConfig<OktaSuspendUserParams, OktaSuspendUserResponse> = {
  id: 'okta_suspend_user',
  name: 'Suspend User in Okta',
  description:
    'Suspend a user in your Okta organization. Only users with ACTIVE status can be suspended. Suspended users cannot log in but retain group and app assignments.',
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
      description: 'User ID or login to suspend',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/users/${encodeURIComponent(params.userId)}/lifecycle/suspend`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `SSWS ${params.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      let error: OktaApiError = {}
      try {
        error = await response.json()
      } catch {
        // empty response body
      }
      logger.error('Okta API request failed', { data: error, status: response.status })
      throw new Error(error.errorSummary || 'Failed to suspend user in Okta')
    }

    return {
      success: true,
      output: {
        userId: params?.userId ?? '',
        suspended: true,
        success: true,
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'Suspended user ID' },
    suspended: { type: 'boolean', description: 'Whether the user was suspended' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
