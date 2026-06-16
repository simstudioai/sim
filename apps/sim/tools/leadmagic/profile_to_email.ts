import { leadmagicHosting } from '@/tools/leadmagic/hosting'
import type {
  LeadMagicProfileToEmailParams,
  LeadMagicProfileToEmailResponse,
} from '@/tools/leadmagic/types'
import type { ToolConfig } from '@/tools/types'

export const profileToEmailTool: ToolConfig<
  LeadMagicProfileToEmailParams,
  LeadMagicProfileToEmailResponse
> = {
  id: 'leadmagic_profile_to_email',
  name: 'LeadMagic Profile to Email',
  description:
    'Extract a verified work email from a LinkedIn profile URL. Charges 5 credits when an email is found; free when no result.',
  version: '1.0.0',

  hosting: leadmagicHosting<LeadMagicProfileToEmailParams>((_params, output) => {
    // 5 credits when email found, 0 otherwise.
    // Source: https://leadmagic.io/docs/v1/reference/profile-to-email
    const consumed = output.credits_consumed
    return typeof consumed === 'number' ? consumed : output.email ? 5 : 0
  }),

  params: {
    profile_url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL or username (e.g., https://linkedin.com/in/johndoe)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LeadMagic API Key',
    },
  },

  request: {
    url: 'https://api.leadmagic.io/v1/people/b2b-profile-email',
    method: 'POST',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ profile_url: params.profile_url }),
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
        email: data.email ?? null,
        profile_url: data.profile_url ?? null,
        credits_consumed: data.credits_consumed ?? 0,
        message: data.message ?? null,
      },
    }
  },

  outputs: {
    email: {
      type: 'string',
      description: 'Work email address found for this profile',
      optional: true,
    },
    profile_url: {
      type: 'string',
      description: 'LinkedIn profile URL used for lookup',
      optional: true,
    },
    credits_consumed: { type: 'number', description: 'Credits charged (5 when email found)' },
    message: { type: 'string', description: 'Human-readable status message', optional: true },
  },
}
