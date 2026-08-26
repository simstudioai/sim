import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaResetFactorParams, OktaResetFactorResponse } from '@/tools/okta/types'
import { isOktaFlagEnabled, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaResetFactor')

export const oktaResetFactorTool: ToolConfig<OktaResetFactorParams, OktaResetFactorResponse> = {
  id: 'okta_reset_factor',
  name: 'Reset Factor in Okta',
  description:
    'Unenroll one specific MFA factor for a user so they can re-enroll it. Destructive and irreversible: the existing enrollment is removed. Unenrolling a push or signed_nonce factor also unenrolls the related Okta Verify factors. Factors cannot be unenrolled from a deactivated user.',
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
      description: 'User ID or login the factor belongs to',
    },
    factorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Factor ID to unenroll',
    },
    removeRecoveryEnrollment: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Also remove the phone number as a recovery method, not only as a factor. Applies to sms and call factors only (default: false)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const base = `https://${domain}/api/v1/users/${safeUrlPathSegment(params.userId, 'userId')}/factors/${safeUrlPathSegment(params.factorId, 'factorId')}`
      return params.removeRecoveryEnrollment === undefined
        ? base
        : `${base}?removeRecoveryEnrollment=${isOktaFlagEnabled(params.removeRecoveryEnrollment)}`
    },
    method: 'DELETE',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to reset factor in Okta')
    }

    return {
      success: true,
      output: {
        userId: params?.userId ?? '',
        factorId: params?.factorId ?? '',
        reset: true,
        success: true,
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'User the factor belonged to' },
    factorId: { type: 'string', description: 'Unenrolled factor ID' },
    reset: { type: 'boolean', description: 'Whether the factor was unenrolled' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
