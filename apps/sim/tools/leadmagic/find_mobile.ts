import { leadmagicHosting } from '@/tools/leadmagic/hosting'
import type {
  LeadMagicFindMobileParams,
  LeadMagicFindMobileResponse,
} from '@/tools/leadmagic/types'
import type { ToolConfig } from '@/tools/types'

export const findMobileTool: ToolConfig<LeadMagicFindMobileParams, LeadMagicFindMobileResponse> = {
  id: 'leadmagic_find_mobile',
  name: 'LeadMagic Find Mobile',
  description:
    "Find a person's direct mobile number from their LinkedIn profile URL or email. Charges 5 credits when a number is found; free when no result.",
  version: '1.0.0',

  hosting: leadmagicHosting<LeadMagicFindMobileParams>((_params, output) => {
    // 5 credits per mobile number found, 0 when not found.
    // Source: https://leadmagic.io/docs/v1/reference/mobile-finder
    const consumed = output.credits_consumed
    return typeof consumed === 'number' ? consumed : output.mobile_number ? 5 : 0
  }),

  params: {
    profile_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL (provide at least one identifier)',
    },
    work_email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Work email address (provide at least one identifier)',
    },
    personal_email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Personal email address (provide at least one identifier)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LeadMagic API Key',
    },
  },

  request: {
    url: 'https://api.leadmagic.io/v1/people/mobile-finder',
    method: 'POST',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {}
      if (params.profile_url) body.profile_url = params.profile_url
      if (params.work_email) body.work_email = params.work_email
      if (params.personal_email) body.personal_email = params.personal_email
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        (errorData as Record<string, string>).message ||
          `LeadMagic API error: ${response.status} ${response.statusText}`
      )
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        profile_url: data.profile_url ?? null,
        email: data.email ?? null,
        mobile_number: data.mobile_number ?? null,
        credits_consumed: data.credits_consumed ?? 0,
        message: data.message ?? null,
      },
    }
  },

  outputs: {
    profile_url: {
      type: 'string',
      description: 'LinkedIn profile URL used for lookup',
      optional: true,
    },
    email: {
      type: 'string',
      description: 'Email address associated with the profile',
      optional: true,
    },
    mobile_number: { type: 'string', description: 'Direct mobile phone number', optional: true },
    credits_consumed: { type: 'number', description: 'Credits charged (5 when mobile found)' },
    message: { type: 'string', description: 'Status message from the API', optional: true },
  },
}
