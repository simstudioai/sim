import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaFactor, OktaGetFactorParams, OktaGetFactorResponse } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaGetFactor')

export const oktaGetFactorTool: ToolConfig<OktaGetFactorParams, OktaGetFactorResponse> = {
  id: 'okta_get_factor',
  name: 'Get Factor from Okta',
  description:
    'Retrieve a single enrolled MFA factor for a user, including its type, provider, enrollment status, and factor-specific profile.',
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
      description: 'Factor ID to look up',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/users/${encodeURIComponent(params.userId.trim())}/factors/${encodeURIComponent(params.factorId.trim())}`
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to get factor from Okta')
    }

    const factor: OktaFactor = await response.json()

    return {
      success: true,
      output: {
        id: factor.id,
        factorType: factor.factorType,
        provider: factor.provider ?? null,
        vendorName: factor.vendorName ?? null,
        status: factor.status ?? null,
        created: factor.created ?? null,
        lastUpdated: factor.lastUpdated ?? null,
        profile: factor.profile ?? null,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Factor ID' },
    factorType: { type: 'string', description: 'Factor type' },
    provider: { type: 'string', description: 'Factor provider', optional: true },
    vendorName: { type: 'string', description: 'Factor vendor name', optional: true },
    status: { type: 'string', description: 'Enrollment status', optional: true },
    created: { type: 'string', description: 'Enrollment timestamp', optional: true },
    lastUpdated: { type: 'string', description: 'Last update timestamp', optional: true },
    profile: {
      type: 'json',
      description:
        'Factor-specific attributes, which vary by factor type (phone number, email, question, credential ID)',
      optional: true,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
