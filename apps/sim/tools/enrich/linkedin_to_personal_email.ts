import type {
  EnrichLinkedInToPersonalEmailParams,
  EnrichLinkedInToPersonalEmailResponse,
} from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const linkedInToPersonalEmailTool: ToolConfig<
  EnrichLinkedInToPersonalEmailParams,
  EnrichLinkedInToPersonalEmailResponse
> = {
  id: 'enrich_linkedin_to_personal_email',
  name: 'Enrich LinkedIn to Personal Email',
  description: 'Find personal email address from a LinkedIn profile URL.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    linkedinProfile: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL (e.g., linkedin.com/in/username)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v2/api/linkedin-to-email')
      url.searchParams.append('linkedin_profile', params.linkedinProfile.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const resultData = data.data ?? data

    return {
      success: true,
      output: {
        email: resultData.email ?? resultData.personal_email ?? null,
        found: resultData.found ?? Boolean(resultData.email ?? resultData.personal_email),
        status: resultData.status ?? null,
      },
    }
  },

  outputs: {
    email: {
      type: 'string',
      description: 'Personal email address',
      optional: true,
    },
    found: {
      type: 'boolean',
      description: 'Whether an email was found',
    },
    status: {
      type: 'string',
      description: 'Request status',
      optional: true,
    },
  },
}
