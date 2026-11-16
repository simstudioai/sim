import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaUnlockUserParams, OktaUnlockUserResponse } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import { OKTA_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaUnlockUser')

export const oktaUnlockUserTool: ToolConfig<OktaUnlockUserParams, OktaUnlockUserResponse> = {
  id: 'okta_unlock_user',
  name: 'Unlock User in Okta',
  description:
    'Unlock a LOCKED_OUT user, or an ACTIVE user blocked from unknown devices, so they can sign in with their current password. Works only for Okta-sourced users, not directory-sourced accounts such as Active Directory.',
  version: '1.0.0',
  oauth: OKTA_CREDENTIAL_OAUTH,

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
      description: 'User ID or login to unlock',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/users/${safeUrlPathSegment(params.userId, 'userId')}/lifecycle/unlock`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to unlock user in Okta')
    }

    return {
      success: true,
      output: {
        userId: params?.userId ?? '',
        unlocked: true,
        success: true,
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'Unlocked user ID' },
    unlocked: { type: 'boolean', description: 'Whether the user was unlocked' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
