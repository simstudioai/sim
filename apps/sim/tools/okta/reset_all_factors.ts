import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaResetAllFactorsParams, OktaResetAllFactorsResponse } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaResetAllFactors')

export const oktaResetAllFactorsTool: ToolConfig<
  OktaResetAllFactorsParams,
  OktaResetAllFactorsResponse
> = {
  id: 'okta_reset_all_factors',
  name: 'Reset All Factors in Okta',
  description:
    'Reset every MFA factor for a user, returning all enrollments to the unenrolled state. Destructive and irreversible: the user must re-enroll each factor before they can complete MFA again. The user status stays ACTIVE.',
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
      description: 'User ID or login whose MFA factors will all be reset',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/users/${safeUrlPathSegment(params.userId, 'userId')}/lifecycle/reset_factors`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to reset all factors in Okta')
    }

    return {
      success: true,
      output: {
        userId: params?.userId ?? '',
        reset: true,
        success: true,
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'User whose factors were reset' },
    reset: { type: 'boolean', description: 'Whether all factors were reset' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
