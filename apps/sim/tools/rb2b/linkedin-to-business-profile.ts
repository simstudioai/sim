import {
  RB2B_LINKEDIN_PROFILE_OUTPUT_PROPERTIES,
  type Rb2bLinkedinParams,
  type Rb2bLinkedinProfileResponse,
} from '@/tools/rb2b/types'
import { RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bLinkedinToBusinessProfileTool: ToolConfig<
  Rb2bLinkedinParams,
  Rb2bLinkedinProfileResponse
> = {
  id: 'rb2b_linkedin_to_business_profile',
  name: 'RB2B LinkedIn to Business Profile',
  description:
    'Return a full business profile (name, title, company, emails and more) for a LinkedIn profile.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RB2B API key',
    },
    linkedin_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The LinkedIn profile slug or URL',
    },
  },

  request: {
    method: 'POST',
    url: `${RB2B_API_BASE}/linkedin_to_business_profile`,
    headers: (params) => rb2bHeaders(params.apiKey),
    body: (params) => ({ linkedin_slug: params.linkedin_slug }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const result = data.result ?? {}
    return {
      success: true,
      output: {
        first_name: result.first_name ?? undefined,
        last_name: result.last_name ?? undefined,
        full_name: result.full_name ?? undefined,
        headline: result.headline ?? undefined,
        title: result.title ?? undefined,
        seniority: result.seniority ?? undefined,
        country: result.country ?? undefined,
        current_industry: result.current_industry ?? undefined,
        functional_area: result.functional_area ?? undefined,
        linkedin_url: result.linkedin_url ?? undefined,
        business_email: result.business_email ?? undefined,
        personal_email: result.personal_email ?? undefined,
        company: result.company ?? undefined,
      },
    }
  },

  outputs: RB2B_LINKEDIN_PROFILE_OUTPUT_PROPERTIES,
}
