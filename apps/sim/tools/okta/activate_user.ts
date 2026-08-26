import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaActivateUserParams, OktaActivateUserResponse } from '@/tools/okta/types'
import { isOktaFlagEnabled, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaActivateUser')

export const oktaActivateUserTool: ToolConfig<OktaActivateUserParams, OktaActivateUserResponse> = {
  id: 'okta_activate_user',
  name: 'Activate User in Okta',
  description:
    'Activate a user in your Okta organization. Can only be performed on users with STAGED or DEPROVISIONED status. Optionally sends an activation email.',
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
      description: 'User ID or login to activate',
    },
    sendEmail: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send activation email to the user (default: true)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const sendEmail = params.sendEmail === undefined ? true : isOktaFlagEnabled(params.sendEmail)
      return `https://${domain}/api/v1/users/${safeUrlPathSegment(params.userId, 'userId')}/lifecycle/activate?sendEmail=${sendEmail}`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to activate user in Okta')
    }

    let activationUrl: string | null = null
    let activationToken: string | null = null
    try {
      const data = await response.json()
      activationUrl = data.activationUrl ?? null
      activationToken = data.activationToken ?? null
    } catch {
      // empty body when sendEmail=true
    }

    return {
      success: true,
      output: {
        userId: params?.userId ?? '',
        activated: true,
        activationUrl,
        activationToken,
        success: true,
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'Activated user ID' },
    activated: { type: 'boolean', description: 'Whether the user was activated' },
    activationUrl: {
      type: 'string',
      description: 'Activation URL (only returned when sendEmail is false)',
      optional: true,
    },
    activationToken: {
      type: 'string',
      description: 'Activation token (only returned when sendEmail is false)',
      optional: true,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
