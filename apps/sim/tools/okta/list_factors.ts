import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaFactor, OktaListFactorsParams, OktaListFactorsResponse } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaListFactors')

export const oktaListFactorsTool: ToolConfig<OktaListFactorsParams, OktaListFactorsResponse> = {
  id: 'okta_list_factors',
  name: 'List Factors from Okta',
  description:
    'List the MFA factors a user has enrolled, with each factor type, provider, and enrollment status. Use this before resetting a factor to confirm which one to target.',
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
      description: 'User ID or login to list enrolled factors for',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/users/${encodeURIComponent(params.userId.trim())}/factors`
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to list factors from Okta')
    }

    const data: OktaFactor[] = await response.json()

    const factors = data.map((factor) => ({
      id: factor.id,
      factorType: factor.factorType,
      provider: factor.provider ?? null,
      vendorName: factor.vendorName ?? null,
      status: factor.status ?? null,
      created: factor.created ?? null,
      lastUpdated: factor.lastUpdated ?? null,
      profile: factor.profile ?? null,
    }))

    return {
      success: true,
      output: {
        factors,
        count: factors.length,
        success: true,
      },
    }
  },

  outputs: {
    factors: {
      type: 'array',
      description: 'Array of enrolled MFA factors',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Factor ID' },
          factorType: {
            type: 'string',
            description:
              'Factor type (sms, call, email, push, question, token:software:totp, webauthn, etc.)',
          },
          provider: {
            type: 'string',
            description: 'Factor provider (OKTA, GOOGLE, FIDO, DUO, RSA, SYMANTEC, YUBICO, CUSTOM)',
            optional: true,
          },
          vendorName: { type: 'string', description: 'Factor vendor name', optional: true },
          status: {
            type: 'string',
            description: 'Enrollment status (ACTIVE, PENDING_ACTIVATION, NOT_SETUP, etc.)',
            optional: true,
          },
          created: { type: 'string', description: 'Enrollment timestamp', optional: true },
          lastUpdated: { type: 'string', description: 'Last update timestamp', optional: true },
          profile: {
            type: 'json',
            description:
              'Factor-specific attributes, which vary by factor type (phone number, email, question, credential ID)',
            optional: true,
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of enrolled factors' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
