import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaUnsuspendUserParams, OktaUnsuspendUserResponse } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaUnsuspendUser')

export const oktaUnsuspendUserTool: ToolConfig<OktaUnsuspendUserParams, OktaUnsuspendUserResponse> =
  {
    id: 'okta_unsuspend_user',
    name: 'Unsuspend User in Okta',
    description:
      'Unsuspend a previously suspended user in your Okta organization. Returns the user to ACTIVE status.',
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
        description: 'User ID or login to unsuspend',
      },
    },

    request: {
      url: (params) => {
        const domain = validateOktaDomain(params.domain)
        return `https://${domain}/api/v1/users/${safeUrlPathSegment(params.userId, 'userId')}/lifecycle/unsuspend`
      },
      method: 'POST',
      headers: (params) => oktaHeaders(params.apiKey),
    },

    transformResponse: async (response: Response, params) => {
      if (!response.ok) {
        await throwOktaError(response, logger, 'Failed to unsuspend user in Okta')
      }

      return {
        success: true,
        output: {
          userId: params?.userId ?? '',
          unsuspended: true,
          success: true,
        },
      }
    },

    outputs: {
      userId: { type: 'string', description: 'Unsuspended user ID' },
      unsuspended: { type: 'boolean', description: 'Whether the user was unsuspended' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
