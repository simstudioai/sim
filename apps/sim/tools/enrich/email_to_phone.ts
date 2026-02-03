import type { EnrichEmailToPhoneParams, EnrichEmailToPhoneResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const emailToPhoneTool: ToolConfig<EnrichEmailToPhoneParams, EnrichEmailToPhoneResponse> = {
  id: 'enrich_email_to_phone',
  name: 'Enrich Email to Phone',
  description: 'Find a phone number associated with an email address.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address to look up (e.g., john.doe@example.com)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/email-to-mobile')
      url.searchParams.append('email', params.email.trim())
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
    if (data.message?.includes('queued')) {
      return {
        success: true,
        output: {
          email: null,
          mobileNumber: null,
          found: false,
          status: 'in_progress',
        },
      }
    }

    return {
      success: true,
      output: {
        email: data.data?.email ?? null,
        mobileNumber: data.data?.mobile_number ?? null,
        found: !!data.data?.mobile_number,
        status: 'completed',
      },
    }
  },

  outputs: {
    email: {
      type: 'string',
      description: 'Email address looked up',
      optional: true,
    },
    mobileNumber: {
      type: 'string',
      description: 'Found mobile phone number',
      optional: true,
    },
    found: {
      type: 'boolean',
      description: 'Whether a phone number was found',
    },
    status: {
      type: 'string',
      description: 'Request status (in_progress or completed)',
      optional: true,
    },
  },
}
