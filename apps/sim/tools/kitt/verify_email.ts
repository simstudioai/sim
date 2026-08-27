import { kittVerifyEmailHosting } from '@/tools/kitt/hosting'
import {
  requireKittResponseObject,
  requireKittResponseString,
  requireKittSuccess,
} from '@/tools/kitt/response'
import type {
  KittVerifyEmailOutcome,
  KittVerifyEmailParams,
  KittVerifyEmailResponse,
} from '@/tools/kitt/types'
import { KITT_EMAIL_OUTPUT, KITT_OUTCOME_OUTPUT } from '@/tools/kitt/types'
import type { ToolConfig } from '@/tools/types'

const VERIFY_EMAIL_OUTCOMES = new Set<KittVerifyEmailOutcome>([
  'valid',
  'valid-risky',
  'invalid',
  'unknown',
])

export const kittVerifyEmailTool: ToolConfig<KittVerifyEmailParams, KittVerifyEmailResponse> = {
  id: 'kitt_verify_email',
  name: 'Kitt Verify Email',
  description:
    'Verify a B2B email address using Kitt real-time email-server and identity-server checks.',
  version: '1.0.0',
  hosting: kittVerifyEmailHosting,
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Kitt API key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address to verify',
    },
    treatAliasesAsValid: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Treat forwarding aliases as valid addresses',
    },
    customData: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Caller-defined metadata associated with the request',
    },
  },
  request: {
    url: 'https://api.trykitt.ai/job/verify_email',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        email: params.email,
        realtime: true,
      }
      if (params.treatAliasesAsValid !== undefined) {
        body.treatAliasesAsValid = params.treatAliasesAsValid
      }
      if (params.customData) body.customData = params.customData
      return body
    },
  },
  transformResponse: async (response, params) => {
    await requireKittSuccess(response, 'verify email')
    if (!params) throw new Error('Kitt verify email request parameters are missing')
    const body: unknown = await response.json()
    const data = requireKittResponseObject(body, 'verify email')
    const outcomeValue = requireKittResponseString(data.outcome, 'outcome', 'verify email')
    if (!VERIFY_EMAIL_OUTCOMES.has(outcomeValue as KittVerifyEmailOutcome)) {
      throw new Error(`Kitt verify email response returned unsupported outcome: ${outcomeValue}`)
    }
    return {
      success: true,
      output: {
        outcome: outcomeValue as KittVerifyEmailOutcome,
        email: params.email,
      },
    }
  },
  outputs: {
    outcome: KITT_OUTCOME_OUTPUT,
    email: KITT_EMAIL_OUTPUT,
  },
}
