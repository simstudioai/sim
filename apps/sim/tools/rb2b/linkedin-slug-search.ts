import type {
  Rb2bLinkedinSlugSearchParams,
  Rb2bLinkedinSlugSearchResponse,
} from '@/tools/rb2b/types'
import { RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bLinkedinSlugSearchTool: ToolConfig<
  Rb2bLinkedinSlugSearchParams,
  Rb2bLinkedinSlugSearchResponse
> = {
  id: 'rb2b_linkedin_slug_search',
  name: 'RB2B LinkedIn Slug Search',
  description: 'Find a LinkedIn profile URL from a first name, last name, and company domain.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RB2B API key',
    },
    first_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The person’s first name',
    },
    last_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The person’s last name',
    },
    company_domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The company domain (e.g. example.com)',
    },
  },

  request: {
    method: 'POST',
    url: `${RB2B_API_BASE}/linkedin_slug_search`,
    headers: (params) => rb2bHeaders(params.apiKey),
    body: (params) => ({
      first_name: params.first_name,
      last_name: params.last_name,
      company_domain: params.company_domain,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        linkedin_url: data.result?.linkedin_url ?? null,
      },
    }
  },

  outputs: {
    linkedin_url: {
      type: 'string',
      description: 'LinkedIn profile URL for the person',
      optional: true,
    },
  },
}
