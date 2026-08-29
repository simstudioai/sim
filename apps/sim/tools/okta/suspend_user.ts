import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaSuspendUserParams, OktaSuspendUserResponse } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
      return `https://${domain}/api/v1/users/${safeUrlPathSegment(params.userId, 'userId')}/lifecycle/suspend`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to suspend user in Okta')
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
