import { kittFindEmailHosting } from '@/tools/kitt/hosting'
import {
  requireKittResponseObject,
  requireKittResponseString,
  requireKittSuccess,
} from '@/tools/kitt/response'
import type {
  KittFindEmailOutcome,
  KittFindEmailParams,
  KittFindEmailResponse,
} from '@/tools/kitt/types'
import { KITT_EMAIL_OUTPUT, KITT_OUTCOME_OUTPUT } from '@/tools/kitt/types'
import type { ToolConfig } from '@/tools/types'

const FIND_EMAIL_OUTCOMES = new Set<KittFindEmailOutcome>(['success', 'no-results-found'])

export const kittFindEmailTool: ToolConfig<KittFindEmailParams, KittFindEmailResponse> = {
  id: 'kitt_find_email',
  name: 'Kitt Find Email',
  description:
    'Find a verified B2B email address from a full name and company domain or website using Kitt real-time enrichment.',
  version: '1.0.0',
  hosting: kittFindEmailHosting,
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Kitt API key',
    },
    fullName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full name exactly as listed on LinkedIn or another public directory',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company email domain or website',
    },
    linkedinStandardProfileURL: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn standard profile URL to improve matching',
    },
    strictNameMatches: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Require strict name matching',
    },
    customData: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Caller-defined metadata associated with the request',
    },
  },
  request: {
    url: 'https://api.trykitt.ai/job/find_email',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        fullName: params.fullName,
        domain: params.domain,
        realtime: true,
      }
      if (params.linkedinStandardProfileURL) {
        body.linkedinStandardProfileURL = params.linkedinStandardProfileURL
      }
      if (params.strictNameMatches !== undefined) {
        body.strictNameMatches = params.strictNameMatches
      }
      if (params.customData) body.customData = params.customData
      return body
    },
  },
  transformResponse: async (response) => {
    await requireKittSuccess(response, 'find email')
    const body: unknown = await response.json()
    const data = requireKittResponseObject(body, 'find email')
    const outcomeValue = requireKittResponseString(data.outcome, 'outcome', 'find email')
    if (!FIND_EMAIL_OUTCOMES.has(outcomeValue as KittFindEmailOutcome)) {
      throw new Error(`Kitt find email response returned unsupported outcome: ${outcomeValue}`)
    }
    const outcome = outcomeValue as KittFindEmailOutcome
    if (outcome === 'no-results-found') {
      return { success: true, output: { outcome, email: null } }
    }
    const results = requireKittResponseObject(data.results, 'find email')
    const email = requireKittResponseString(
      results.botGeneratedEmail,
      'results.botGeneratedEmail',
      'find email'
    )
    return { success: true, output: { outcome, email } }
  },
  outputs: {
    outcome: KITT_OUTCOME_OUTPUT,
    email: KITT_EMAIL_OUTPUT,
  },
}
