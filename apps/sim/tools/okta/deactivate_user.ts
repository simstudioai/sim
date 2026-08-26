import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaDeactivateUserParams, OktaDeactivateUserResponse } from '@/tools/okta/types'
import { isOktaFlagEnabled, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaDeactivateUser')

export const oktaDeactivateUserTool: ToolConfig<
  OktaDeactivateUserParams,
  OktaDeactivateUserResponse
> = {
  id: 'okta_deactivate_user',
  name: 'Deactivate User in Okta',
  description:
    'Deactivate a user in your Okta organization. This transitions the user to DEPROVISIONED status.',
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
      description: 'User ID or login to deactivate',
    },
    sendEmail: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send deactivation email to admin (default: false)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const sendEmail = isOktaFlagEnabled(params.sendEmail)
      return `https://${domain}/api/v1/users/${safeUrlPathSegment(params.userId, 'userId')}/lifecycle/deactivate?sendEmail=${sendEmail}`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to deactivate user in Okta')
    }

    return {
      success: true,
      output: {
        userId: params?.userId ?? '',
        deactivated: true,
        success: true,
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'Deactivated user ID' },
    deactivated: { type: 'boolean', description: 'Whether the user was deactivated' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
