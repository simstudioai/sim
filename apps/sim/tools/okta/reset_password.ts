import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaResetPasswordParams, OktaResetPasswordResponse } from '@/tools/okta/types'
import { isOktaFlagEnabled, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaResetPassword')

export const oktaResetPasswordTool: ToolConfig<OktaResetPasswordParams, OktaResetPasswordResponse> =
  {
    id: 'okta_reset_password',
    name: 'Reset Password in Okta',
    description:
      'Generate a one-time token to reset a user password. Can email the reset link to the user or return it directly. Transitions the user to RECOVERY status.',
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
        description: 'User ID or login to reset password for',
      },
      sendEmail: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Send password reset email to the user. Okta requires this parameter and declares no default of its own; leaving it blank sends the email',
      },
    },

    request: {
      url: (params) => {
        const domain = validateOktaDomain(params.domain)
        const sendEmail =
          params.sendEmail === undefined ? true : isOktaFlagEnabled(params.sendEmail)
        return `https://${domain}/api/v1/users/${safeUrlPathSegment(params.userId, 'userId')}/lifecycle/reset_password?sendEmail=${sendEmail}`
      },
      method: 'POST',
      headers: (params) => oktaHeaders(params.apiKey),
    },

    transformResponse: async (response: Response, params) => {
      if (!response.ok) {
        await throwOktaError(response, logger, 'Failed to reset password in Okta')
      }

      let resetPasswordUrl: string | null = null
      try {
        const data = await response.json()
        resetPasswordUrl = data.resetPasswordUrl ?? null
      } catch {
        // empty body when sendEmail=true
      }

      return {
        success: true,
        output: {
          userId: params?.userId ?? '',
          resetPasswordUrl,
          success: true,
        },
      }
    },

    outputs: {
      userId: { type: 'string', description: 'User ID' },
      resetPasswordUrl: {
        type: 'string',
        description: 'Password reset URL (only returned when sendEmail is false)',
        optional: true,
      },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
