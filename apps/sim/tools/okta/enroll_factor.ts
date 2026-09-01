import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaEnrollFactorParams,
  OktaEnrollFactorResponse,
  OktaFactor,
} from '@/tools/okta/types'
import { isOktaFlagEnabled, oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaEnrollFactor')

export const oktaEnrollFactorTool: ToolConfig<OktaEnrollFactorParams, OktaEnrollFactorResponse> = {
  id: 'okta_enroll_factor',
  name: 'Enroll Factor in Okta',
  description:
    'Enroll an MFA factor for a user. The profile fields required depend on the factor type: a phone number for sms and call, an email address for email, and a question and answer for question. Factors that enroll from the user device, such as webauthn and push, need no profile fields.',
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
      description: 'Okta user ID (not a login or email) to enroll the factor for',
    },
    factorType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Factor type to enroll (sms, call, email, question, push, token:software:totp, u2f, webauthn)',
    },
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Factor provider (OKTA, GOOGLE, FIDO, DUO, RSA, SYMANTEC, YUBICO, CUSTOM). Each provider supports a subset of factor types',
    },
    phoneNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number in E.164 format. Required for the sms and call factor types',
    },
    factorEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address to enroll. Required for the email factor type',
    },
    securityQuestion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Security question key (e.g., disliked_food). Required for the question factor type',
    },
    securityAnswer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Answer to the security question, minimum 4 characters. Required for the question factor type',
    },
    activate: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Activate the factor immediately as part of enrollment. Supported by the sms, call, email, and token:hotp factor types (default: false)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const base = `https://${domain}/api/v1/users/${encodeURIComponent(params.userId.trim())}/factors`
      return params.activate === undefined
        ? base
        : `${base}?activate=${isOktaFlagEnabled(params.activate)}`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
    body: (params) => {
      const profile: Record<string, string> = {}

      if (params.phoneNumber) profile.phoneNumber = params.phoneNumber
      if (params.factorEmail) profile.email = params.factorEmail
      if (params.securityQuestion) profile.question = params.securityQuestion
      if (params.securityAnswer) profile.answer = params.securityAnswer

      const body: Record<string, unknown> = {
        factorType: params.factorType,
        provider: params.provider,
      }
      if (Object.keys(profile).length > 0) body.profile = profile

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to enroll factor in Okta')
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
        enrolled: true,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Enrolled factor ID' },
    factorType: { type: 'string', description: 'Factor type' },
    provider: { type: 'string', description: 'Factor provider', optional: true },
    vendorName: { type: 'string', description: 'Factor vendor name', optional: true },
    status: {
      type: 'string',
      description: 'Enrollment status, typically PENDING_ACTIVATION until the user activates it',
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
    enrolled: { type: 'boolean', description: 'Whether the factor was enrolled' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
