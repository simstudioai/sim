import type { Rb2bIdentifierParams, Rb2bLinkedinSlugResponse } from '@/tools/rb2b/types'
import { buildIdentifierBody, RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bHemToLinkedinTool: ToolConfig<Rb2bIdentifierParams, Rb2bLinkedinSlugResponse> = {
  id: 'rb2b_hem_to_linkedin',
  name: 'RB2B Email/HEM to LinkedIn Slug',
  description:
    'Return the LinkedIn slug (the profile identifier portion of the URL) for an email address or MD5-hashed email.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RB2B API key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'A plaintext email address or an MD5 hash of the email',
    },
  },

  request: {
    method: 'POST',
    url: `${RB2B_API_BASE}/hem_to_linkedin`,
    headers: (params) => rb2bHeaders(params.apiKey),
    body: (params) => buildIdentifierBody(params.email),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        linkedin_slug: data.results?.linkedin_slug ?? null,
      },
    }
  },

  outputs: {
    linkedin_slug: {
      type: 'string',
      description: 'LinkedIn slug for the email',
      optional: true,
    },
  },
}
