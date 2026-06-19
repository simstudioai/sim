import {
  API_BASE,
  authHeaders,
  type DataForB2BEnrichProfileParams,
  type DataForB2BEnrichProfileResponse,
} from '@/tools/dataforb2b/types'
import type { ToolConfig } from '@/tools/types'

const ENRICH_FLAGS = [
  'enrich_profile',
  'enrich_work_email',
  'enrich_personal_email',
  'enrich_phone',
  'enrich_github',
] as const

export const dataforb2bEnrichProfileTool: ToolConfig<
  DataForB2BEnrichProfileParams,
  DataForB2BEnrichProfileResponse
> = {
  id: 'dataforb2b_enrich_profile',
  name: 'DataForB2B Enrich LinkedIn Profile',
  description:
    'Look up and enrich a professional profile from a LinkedIn URL with DataForB2B. Returns the full profile (current role, experience, skills) plus work email, personal email, phone and GitHub. An email finder for lead enrichment. At least one enrich_* flag is used (defaults to the full profile).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'DataForB2B API key (https://app.dataforb2b.ai)',
    },
    profile_identifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'LinkedIn profile URL, public id (e.g. john-doe) or encoded id (prof_...). Encoded id recommended.',
    },
    enrich_profile: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return the full profile (role, experience, skills)',
    },
    enrich_work_email: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Find the professional/work email',
    },
    enrich_personal_email: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Find the personal email',
    },
    enrich_phone: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Find the phone number',
    },
    enrich_github: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Find the GitHub profile',
    },
  },

  request: {
    url: `${API_BASE}/enrich/profile`,
    method: 'POST',
    headers: (params) => authHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { profile_identifier: params.profile_identifier }
      let anyFlag = false
      for (const flag of ENRICH_FLAGS) {
        if (params[flag]) {
          body[flag] = true
          anyFlag = true
        }
      }
      // The API requires at least one enrich_* flag — default to the full profile.
      if (!anyFlag) body.enrich_profile = true
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DataForB2B API error: ${response.status} - ${errorText}`)
    }
    const data = await response.json()
    // The API returns { profile, work_email, personal_email, phone, git_profile }.
    return {
      success: true,
      output: {
        profile: data.profile ?? data,
        work_email: data.work_email ?? null,
        personal_email: data.personal_email ?? null,
        phone: data.phone ?? null,
        git_profile: data.git_profile ?? null,
      },
    }
  },

  outputs: {
    profile: {
      type: 'json',
      description: 'Enriched profile: identity, current role, experience, skills, education',
    },
    work_email: {
      type: 'json',
      description: 'Professional/work email (when requested)',
      optional: true,
    },
    personal_email: {
      type: 'json',
      description: 'Personal email (when requested)',
      optional: true,
    },
    phone: { type: 'json', description: 'Phone number (when requested)', optional: true },
    git_profile: { type: 'json', description: 'GitHub profile (when requested)', optional: true },
  },
}
