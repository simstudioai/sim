import type { Rb2bLinkedinParams, Rb2bMobilePhoneResponse } from '@/tools/rb2b/types'
import { RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bLinkedinToMobilePhoneTool: ToolConfig<
  Rb2bLinkedinParams,
  Rb2bMobilePhoneResponse
> = {
  id: 'rb2b_linkedin_to_mobile_phone',
  name: 'RB2B LinkedIn to Mobile Phone',
  description:
    'Return the mobile phone number with the most recent known network activity for a LinkedIn profile.',
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
    url: `${RB2B_API_BASE}/linkedin_to_mobile_phone`,
    headers: (params) => rb2bHeaders(params.apiKey),
    body: (params) => ({ linkedin_slug: params.linkedin_slug }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        mobile_phone: data.result?.mobile_phone ?? null,
      },
    }
  },

  outputs: {
    mobile_phone: {
      type: 'string',
      description: 'Mobile phone number for the LinkedIn profile',
      optional: true,
    },
  },
}
