import { findymailHosting } from '@/tools/findymail/hosting'
import type { FindymailFindPhoneParams, FindymailFindPhoneResponse } from '@/tools/findymail/types'
import type { ToolConfig } from '@/tools/types'

export const findPhoneTool: ToolConfig<FindymailFindPhoneParams, FindymailFindPhoneResponse> = {
  id: 'findymail_find_phone',
  name: 'Findymail Find Phone',
  description:
    "Find someone's phone number from a LinkedIn profile URL. Uses 10 finder credits if a phone is found. EU citizens are excluded for legal reasons.",
  version: '1.0.0',

  hosting: findymailHosting<FindymailFindPhoneParams>((_params, output) => {
    // Phone lookups consume 10 finder credits, only when a number is found.
    return output.phone ? 10 : 0
  }),

  params: {
    linkedin_url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Person's LinkedIn URL or username (e.g., 'https://linkedin.com/in/johndoe' or 'johndoe')",
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Findymail API Key',
    },
  },

  request: {
    url: 'https://app.findymail.com/api/search/phone',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => ({ linkedin_url: params.linkedin_url }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          (errorData as Record<string, string>).error ||
          `Findymail API error: ${response.status} ${response.statusText}`,
        output: { phone: null, line_type: null },
      }
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        phone: data.phone ?? null,
        line_type: data.line_type ?? null,
      },
    }
  },

  outputs: {
    phone: {
      type: 'string',
      description: 'Phone number in E.164 format. Only available for US numbers.',
      optional: true,
    },
    line_type: {
      type: 'string',
      description: 'Phone line type (e.g., "Mobile", "Landline")',
      optional: true,
    },
  },
}
