import type {
  EnrichLinkedInToWorkEmailParams,
  EnrichLinkedInToWorkEmailResponse,
} from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const linkedInToWorkEmailTool: ToolConfig<
  EnrichLinkedInToWorkEmailParams,
  EnrichLinkedInToWorkEmailResponse
> = {
  id: 'enrich_linkedin_to_work_email',
  name: 'Enrich LinkedIn to Work Email',
  description: 'Find a work email address from a LinkedIn profile URL.',
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
      description: 'LinkedIn profile URL (e.g., https://www.linkedin.com/in/williamhgates)',
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
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Handle queued response (202)
    if (data.status === 'in_progress' || data.message?.includes('queued')) {
      return {
        success: true,
        output: {
          email: null,
          found: false,
          status: 'in_progress',
        },
      }
    }

    return {
      success: true,
      output: {
        email: data.email ?? null,
        found: data.found ?? false,
        status: 'completed',
      },
    }
  },

  outputs: {
    email: {
      type: 'string',
      description: 'Found work email address',
      optional: true,
    },
    found: {
      type: 'boolean',
      description: 'Whether an email was found',
    },
    status: {
      type: 'string',
      description: 'Request status (in_progress or completed)',
      optional: true,
    },
  },
}
