import type { Rb2bBestPersonalEmailResponse, Rb2bLinkedinParams } from '@/tools/rb2b/types'
import { RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bLinkedinToBestPersonalEmailTool: ToolConfig<
  Rb2bLinkedinParams,
  Rb2bBestPersonalEmailResponse
> = {
  id: 'rb2b_linkedin_to_best_personal_email',
  name: 'RB2B LinkedIn to Best Personal Email',
  description:
    'Return the personal email with the most recent known network activity for a LinkedIn profile.',
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
    url: `${RB2B_API_BASE}/linkedin_to_best_personal_email`,
    headers: (params) => rb2bHeaders(params.apiKey),
    body: (params) => ({ linkedin_slug: params.linkedin_slug }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        email: data.result?.email ?? null,
      },
    }
  },

  outputs: {
    email: {
      type: 'string',
      description: 'Best personal email for the LinkedIn profile',
      optional: true,
    },
  },
}
