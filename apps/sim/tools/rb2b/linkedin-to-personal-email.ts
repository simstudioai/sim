import type { Rb2bLinkedinParams, Rb2bPersonalEmailsResponse } from '@/tools/rb2b/types'
import { RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bLinkedinToPersonalEmailTool: ToolConfig<
  Rb2bLinkedinParams,
  Rb2bPersonalEmailsResponse
> = {
  id: 'rb2b_linkedin_to_personal_email',
  name: 'RB2B LinkedIn to Personal Email',
  description: 'Return the personal email addresses associated with a LinkedIn profile.',
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
    url: `${RB2B_API_BASE}/linkedin_to_personal_email`,
    headers: (params) => rb2bHeaders(params.apiKey),
    body: (params) => ({ linkedin_slug: params.linkedin_slug }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        emails: data.result?.emails ?? [],
      },
    }
  },

  outputs: {
    emails: {
      type: 'array',
      description: 'Personal email addresses for the LinkedIn profile',
      items: { type: 'string' },
    },
  },
}
