import { leadmagicHosting } from '@/tools/leadmagic/hosting'
import type {
  LeadMagicEmailToProfileParams,
  LeadMagicEmailToProfileResponse,
} from '@/tools/leadmagic/types'
import type { ToolConfig } from '@/tools/types'

export const emailToProfileTool: ToolConfig<
  LeadMagicEmailToProfileParams,
  LeadMagicEmailToProfileResponse
> = {
  id: 'leadmagic_email_to_profile',
  name: 'LeadMagic Email to Profile',
  description:
    'Retrieve a LinkedIn profile URL from a work or personal email address. Charges 10 credits when a profile is found; free when no result.',
  version: '1.0.0',

  hosting: leadmagicHosting<LeadMagicEmailToProfileParams>((_params, output) => {
    // 10 credits when profile found, 0 otherwise.
    // Source: https://leadmagic.io/docs/v1/reference/email-to-profile
    const consumed = output.credits_consumed
    return typeof consumed === 'number' ? consumed : output.profile_url ? 10 : 0
  }),

  params: {
    work_email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Work email address (provide at least one of work_email or personal_email)',
    },
    personal_email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Personal email address (provide at least one of work_email or personal_email)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LeadMagic API Key',
    },
  },

  request: {
    url: 'https://api.leadmagic.io/v1/people/b2b-profile',
    method: 'POST',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {}
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
        credits_consumed: data.credits_consumed ?? 0,
        message: data.message ?? null,
      },
    }
  },

  outputs: {
    profile_url: {
      type: 'string',
      description: 'LinkedIn profile URL for the provided email',
      optional: true,
    },
    credits_consumed: { type: 'number', description: 'Credits charged (10 when profile found)' },
    message: { type: 'string', description: 'Human-readable status message', optional: true },
  },
}
